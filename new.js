window.AudioContext = window.AudioContext || window.webkitAudioContext;

var audioContext = null;
var isPlaying = false;
var sourceNode = null;
var analyser = null;
var theBuffer = null;
var DEBUGCANVAS = null;
var mediaStreamSource = null;
var detectorElem,
    canvasElem,
    waveCanvas,
    pitchElem,
    noteElem,
    detuneElem,
    detuneAmount;

///////////////////////////////////////////////////////////////////////////////////////

window.onload = function() {
    audioContext = new AudioContext();
    // Might not even need MAX_SIZE
    var MAX_SIZE = Math.max(4, Math.floor(audioContext.sampleRate / 5000));	// corresponds to a 5kHz signal

    // This is to load in the demo sound. Don't need that.
    // var request = new XMLHttpRequest();
    // request.open("GET", "../sounds/whistling3.ogg", true);
    // request.responseType = "arraybuffer";
    // request.onload = function() {
    //     audioContext.decodeAudioData(request.response, function(buffer) {
    //         theBuffer = buffer;
    //     });
    // }
    // request.send();

    noteElem = document.getElementById("note");
    // canvasElem = document.getElementById("output");
    pitchElem = document.getElementById("pitch");
    detuneElem = document.getElementById("detune");
    detuneAmount = document.getElementById("detune_amt");
    detectorElem = document.getElementById('detectorElem'); // Don't think I need this

}

function error() {
    alert('Stream generation failed.');
}


// prompt user for mic access
function getUserMedia(dictionary, callback) {
    try {
        navigator.getUserMedia =
            navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia;
        navigator.getUserMedia(dictionary, callback, error);
    } catch (e) {
        alert('getUserMedia threw exception :' + e);
    }
}

// receives MediaStream obj (mic) once granted
function gotStream(stream) {
    // Create an AudioNode from the stream.
    mediaStreamSource = audioContext.createMediaStreamSource(stream);

    // Connect it to the destination.
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    mediaStreamSource.connect(analyser);
    updatePitch();
}

// Toggle live mic input and processes it w/ Web Audio API
function toggleLiveInput() {
    if (isPlaying) {
        //stop playing and return
        //sourceNode.stop(0); // We're not actually using source node. That is only used for audio playback.
        //sourceNode = null;
        analyser = null;
        isPlaying = false;
        console.log("Turned input off");
        if (!window.cancelAnimationFrame)
            window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
        window.cancelAnimationFrame(rafID);

        // Clear detected notes and pitch info once mic toggled off
        detectorElem.className = "vague";
        pitchElem.innerText = "";
        noteElem.innerText = "";
        detuneElem.className = "";
        detuneAmount.innerText = "";
    }
    else {
        isPlaying = true;
        console.log("Turned input on");

        // Request mic access, passes audio constraints obj that disables browser audio processing features.
        // When access is granted, calls gotStream to process live mic input stream.
        getUserMedia(
            {
                "audio": {
                    "mandatory": {
                        "googEchoCancellation": "false",
                        "googAutoGainControl": "false",
                        "googNoiseSuppression": "false",
                        "googHighpassFilter": "false"
                    },
                    "optional": []
                },
            }, gotStream);
    }
}

// To play the demo sound and get the pitches from it.
// Might be useful for playing the metronome click audio.
// function togglePlayback() {
//     if (isPlaying) {
//         //stop playing and return
//         sourceNode.stop(0);
//         sourceNode = null;
//         analyser = null;
//         isPlaying = false;
//         if (!window.cancelAnimationFrame)
//             window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
//         window.cancelAnimationFrame(rafID);
//         return "start";
//     }
//
//     sourceNode = audioContext.createBufferSource();
//     sourceNode.buffer = theBuffer;
//     sourceNode.loop = true;
//
//     analyser = audioContext.createAnalyser();
//     analyser.fftSize = 2048;
//     sourceNode.connect(analyser);
//     analyser.connect(audioContext.destination);
//     sourceNode.start(0);
//     isPlaying = true;
//     isLiveInput = false;
//     updatePitch();
//
//     return "stop";
// }

var rafID = null; // Stores ID for animation frame request, used to repeatedly call updatePitch.
// var tracks = null; not used
var buflen = 2048;
var buf = new Float32Array(buflen); // Buffer array holds audio data for analysis.

var noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Converts frequency (Hz) to corresponding MIDI note number.
function noteFromPitch(frequency) {
    var noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    return Math.round(noteNum) + 69;
}

// Converts freq to MIDI note and calculates octave number
function noteFromPitchWithOctave(frequency) {
    var noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    var midiNote = Math.round(noteNum) + 69;

    var noteName = noteStrings[midiNote % 12]; // Get the note name
    var octave = Math.floor(midiNote / 12) - 1; // MIDI octave formula

    return octave; // e.g., "E2", "E5"
}

// Converts MIDI note number to corresponding frequency (Hz)
function frequencyFromNoteNumber(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

// Calculates the detuning of a freq relative to a given note, in cents.
function centsOffFromPitch(frequency, note) {
    // Computes the freq of the note, then finds how many cents the freq deviates from that note.
    return Math.floor(1200 * Math.log(frequency / frequencyFromNoteNumber(note)) / Math.log(2));
}

// Detects pitch of audio buffer using autocorrelation technique.
function autoCorrelate(buf, sampleRate) {
    /*
    Implements the ACF2+ algorithm
    performs autocorrelation, a technique used to find repeating patterns in a signal. The key steps include:

    - RMS Calculation: It calculates the root mean square (RMS) to assess signal strength. If the signal is too weak, it returns -1 to indicate no valid pitch.
    - Signal Clipping: It trims the buffer for noise reduction by removing values below a threshold.
    - Autocorrelation Calculation: The main algorithm for pitch detection. It compares the signal with shifted versions of itself and looks for the peak in the autocorrelation function (c[i]). The position of the peak (T0) corresponds to the pitch period.
    - Pitch Calculation: Converts the detected period T0 into a frequency using sampleRate / T0.
    */

    var SIZE = buf.length;
    var rms = 0;

    for (var i = 0; i < SIZE; i++) {
        var val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) // not enough signal
        return -1;

    var r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (var i = 0; i < SIZE / 2; i++)
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (var i = 1; i < SIZE / 2; i++)
        if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }

    buf = buf.slice(r1, r2);
    SIZE = buf.length;

    var c = new Array(SIZE).fill(0);
    for (var i = 0; i < SIZE; i++)
        for (var j = 0; j < SIZE - i; j++)
            c[i] = c[i] + buf[j] * buf[j + i];

    var d = 0; while (c[d] > c[d + 1]) d++;
    var maxval = -1, maxpos = -1;
    for (var i = d; i < SIZE; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    var T0 = maxpos;

    var x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    var a = (x1 + x3 - 2 * x2) / 2;
    var b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
}

// Continuously updates detected pitch in real time by processing audio signal.
function updatePitch(time) {
    var cycles = new Array;
    analyser.getFloatTimeDomainData(buf); // Gets time-domain data representing the raw audio waveform.
    var ac = autoCorrelate(buf, audioContext.sampleRate); // call to detech the pitch of the signal.

    if (ac == -1) { // If ac == -1 the pitch is not valid. "vague", clear display.
        detectorElem.className = "vague";
        pitchElem.innerText = "";
        noteElem.innerText = "";
        detuneElem.className = "";
        detuneAmount.innerText = "";
    } else { // If ac != 1 a valid pitch is detected. "confident" update UI.
        detectorElem.className = "confident";
        pitch = ac;
        pitchElem.innerText = Math.round(pitch);
        var note = noteFromPitch(pitch);
        var octave = noteFromPitchWithOctave(pitch)
        noteElem.innerHTML = noteStrings[note % 12] + octave;
        var detune = centsOffFromPitch(pitch, note);
        if (detune == 0) { // If note is not sharp or flat
            detuneElem.className = "";
            detuneAmount.innerHTML = "";
        } else {
            // Calc if freq is sharp or flat
            if (detune < 0)
                detuneElem.className = "flat";
            else
                detuneElem.className = "sharp";
            detuneAmount.innerHTML = Math.abs(detune); // prob don't need
        }
    }

    // Ensures updatePitch is repeatedly called for continous pitch deteciton.
    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = window.webkitRequestAnimationFrame; // Assigns fallback incase requestAnimationFrame not available in browser.
    rafID = window.requestAnimationFrame(updatePitch); // Calls reqAnimFram (better than setTimeout or setInterval) passing in updatePitch as the function to be executed before the next browser repaint
    // Repeatedly calls updatePitch, function is executed every frame, ensuring smooth real-time updates.
}

var start_live_button = document.getElementById('toggleLive');
start_live_button.addEventListener("click", toggleLiveInput)
