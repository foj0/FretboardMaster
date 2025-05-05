window.AudioContext = window.AudioContext || window.webkitAudioContext;
import fs from 'fs';
import wav from 'wav-decoder';
import.meta.env.VITE_SOMETHING // for process in test function

// Variables for pitch detection
var audioContext = null;
var isListening = false; // bool for whether mic input is on
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
import Wad from 'web-audio-daw';
import { allNotesArray, naturalNotesArray } from './constants';
// Global reference to the tuner and mic
let tuner = null;
let mic = null;
let targetNote = null; // correct target note
let currentNote = null; // store the note currently being detected by mic
let score = 0; // number of target notes hit correctly this round
let totalNotes = 0; // total number of target notes since starting this round

// metronome stuff

//let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let isPlaying = false; // Tracks whether the metronome is running
let tempo = 40.0; // BPM
let nextNoteTime = 0.0; // When the next click should be scheduled
let scheduleAheadTime = 0.1; // How far ahead to schedule audio (in seconds)
let clickBuffer = null; // store the metronome click audio file
let hasPlayedCorrectNoteAlready = false; // Whether the correct note ding has already been played for this note.

// To be able to switch between algorithms on app
const pitchAlgorithms = {
    ACF: autoCorrelate,
    AMDF: secondOptimizedAMDF,
    COMBINED: oneBitAMDF_ACF,
};

//let selectedAlgorithm = 'ACF'; // Default
let selectedAlgorithm = pitchAlgorithms['ACF']; // Use selected pitch detection algorithm: ACF/AMDF/COMBINED. ACF Default

// Arrays to store waveforms at each step for visualization
var amdfValues = [];
var oneBitAmdf = [];
var acfValues = [];

///////////////////////////////////////////////////////////////////////////////////////
// Functions for pitch detection
window.onload = function() {
    audioContext = new AudioContext();

    var MAX_SIZE = Math.max(4, Math.floor(audioContext.sampleRate / 5000));	// corresponds to a 5kHz signal

    noteElem = document.getElementById("note");
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
    if (isListening) {
        //stop playing and return
        analyser = null;
        isListening = false;
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
        isListening = true;
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
    var rms = 0; // Root mean square of the signal (signal strength)

    // Compute the sum of squares of all sample values
    for (var i = 0; i < SIZE; i++) {
        var val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE); // take the sqrt of the avg of the squared vals to get actual RMS.
    if (rms < 0.01) // not enough signal
        return -1;

    var r1 = 0, r2 = SIZE - 1, thres = 0.2; // r's used to trim buffer. thres used to ignore noise/silence
    for (var i = 0; i < SIZE / 2; i++) // find where real signal starts
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (var i = 1; i < SIZE / 2; i++) // find where signal dies down
        if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    // console.log(`r1: ${r1} r2: ${r2}`);

    // trim buffer to just the important parts of the signal
    buf = buf.slice(r1, r2);
    SIZE = buf.length;

    var c = new Array(SIZE).fill(0); // array to hold autocorrelation vals
    acfValues = new Array(r1).fill(null); // Pad with nulls or 0s
    // Main Autocorrelation algorithm
    // For each possible lag i, compute the correlation between the signal and itself shifted by i samples
    // and sums the product at j and j + 1, giving a peak when the delay matches the signal's period.
    for (var i = 0; i < SIZE; i++) { // i is the lag (how much we're shifting)
        for (var j = 0; j < SIZE - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i]; // multiply the unshifted signal with the shifted verison
        } // j walks through the valid range of the signal
        acfValues.push(c[i]); // add to visualization array
    }
    // The sum of products across the whole signal (for each lag) finds the autocorrelation for the entire signal at that lag.

    var d = 0; while (c[d] > c[d + 1]) d++; // skip part where correlation is decreasing (ignores the zero-lag peak) to go straight to relevant periodic peaks
    var maxval = -1, maxpos = -1;
    for (var i = d; i < SIZE; i++) { // find the max val in the autocorr arr. This peak represents the best match for the signal's period
        if (c[i] > maxval) {
            // console.log(`Checking Lag ${i}: ACF = ${c[i]}, MaxVal = ${maxval}`);
            maxval = c[i];
            maxpos = i;
        }
    }
    var T0 = maxpos; // lag (in samples) where autocorrelation is the strongest. The period of the pitch.
    // console.log(`T0: ${T0}`);

    // Parabolic interpolation to refine estimate of T0. Estimates true peak location for better precision.
    var x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    var a = (x1 + x3 - 2 * x2) / 2;
    var b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);
    // console.log(`Interpolated T0: ${T0}`);
    // console.log(`SampleRate = ${sampleRate}`);

    return sampleRate / T0; // Convert period T0 in samples to frequency in Hz, this is the estimated pitch.
}


function secondOptimizedAMDF(buf, sampleRate) {
    const SIZE = buf.length;
    const minFrequency = 50;
    const maxFrequency = 1000;
    const silenceThreshold = 0.01;
    const windowThreshold = 0.2;
    const sensitivity = 0.1;   // 10–30% into the dip range

    // 1) RMS silence check
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < silenceThreshold) return -1;

    // 2) Window trim
    let r1 = 0, r2 = SIZE;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) > windowThreshold) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) > windowThreshold) { r2 = SIZE - i; break; }
    const W = r2 - r1;
    if (W < 2) return -1;

    // 3) Lag bounds
    const minLag = Math.floor(sampleRate / maxFrequency);
    const maxLag = Math.min(Math.floor(sampleRate / minFrequency), W - 1);
    // console.log("minLag: " + minLag);
    // console.log("maxLag: " + maxLag);

    // 4) Build AMDF array
    const amdf = new Array(maxLag + 1).fill(0);
    amdfValues = new Array(minLag).fill(null); // Pad with nulls or 0s

    let globalMin = Infinity, globalMax = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = r1; i < r2 - lag; i++) {
            sum += Math.abs(buf[i] - buf[i + lag]);
        }
        amdf[lag] = sum;
        amdfValues[lag] = sum // push to visualization array
        if (sum < globalMin) globalMin = sum;
        if (sum > globalMax) globalMax = sum;
    }

    // 5) First‑dip detection
    // Go through the waveform amdf values until we find the first major dip (amfd value lower than theta)
    const theta = sensitivity * (globalMax - globalMin) + globalMin; // determines how low the dip should be to be the fundamental freq
    // console.log("Theta: " + theta);
    let initLag = minLag;
    while (initLag <= maxLag && amdf[initLag] > theta) {
        // console.log(`Checking initLag ${initLag}: AMDF = ${amdf[initLag]}, theta = ${theta}`);
        initLag++;
    }
    if (initLag > maxLag) return -1;
    // console.log("Final initLag location: " + initLag);

    // 6) Local search around initLag for the "best" lag with the minimum admf value
    const searchRadius = Math.floor(minLag / 2);
    let bestLag = initLag, bestVal = amdf[initLag];
    const start = Math.max(minLag, initLag - searchRadius);
    const end = Math.min(maxLag, initLag + searchRadius);
    for (let lag = start; lag <= end; lag++) {
        if (amdf[lag] < bestVal) {
            bestVal = amdf[lag];
            bestLag = lag;
        }
    }

    // 7) Parabolic refine
    let T0 = bestLag;
    // console.log("T0: " + T0);
    if (bestLag > minLag && bestLag < maxLag) {
        const y1 = amdf[bestLag - 1], y2 = amdf[bestLag], y3 = amdf[bestLag + 1];
        const a = (y1 + y3 - 2 * y2) / 2, b = (y3 - y1) / 2;
        if (a !== 0) T0 = bestLag - b / (2 * a);
    }

    console.log(sampleRate);
    return sampleRate / T0;
}

// helper to recompute a single lag’s sum
function computeAmdPoint(buf, r1, r2, lag) {
    let sum = 0;
    for (let i = r1; i < r2 - lag; i++) {
        sum += Math.abs(buf[i] - buf[i + lag]);
    }
    return sum;
}


function oneBitAMDF_ACF(buf, sampleRate) {
    console.log(`SampleRate = ${sampleRate}`);
    const N = buf.length;
    const minF = 50, maxF = 1000;
    const minLag = Math.floor(sampleRate / maxF);
    const maxLag = Math.min(Math.floor(sampleRate / minF), N - 1);
    console.log("minLag: " + minLag);
    console.log("maxLag: " + maxLag);

    // 1) AMDF → amdf[], Vmin, Vmax  (same as before)
    const amdf = new Array(maxLag + 1).fill(0);
    amdfValues = new Array(minLag).fill(null); // Pad with nulls or 0s

    let Vmin = Infinity, Vmax = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < N - lag; i++) sum += Math.abs(buf[i] - buf[i + lag]);
        amdf[lag] = sum;
        amdfValues[lag] = sum // push to visualization array
        //amdfValues.push(sum); // push to array for visualization
        if (sum < Vmin) Vmin = sum;
        if (sum > Vmax) Vmax = sum;
    }

    // 2) One-bit clipping → bit[]
    const alpha = 0.4, theta = alpha * (Vmin + Vmax); // given by paper, favors wider dips
    console.log(`Theta = ${theta}`);
    const bit = amdf.map((v, i) => (i >= minLag ? (v < theta ? 1 : 0) : 0));


    // Push to array for visualization
    for (let v of bit) {
        oneBitAmdf.push(v)
    }

    // 3) ACF on bit[] → acf[]
    const acf = new Array(maxLag + 1).fill(0);
    acfValues = new Array(minLag).fill(null); // Pad with nulls or 0s up to minLag
    for (let k = minLag; k <= maxLag; k++) {
        let s = 0;
        for (let n = 0; n + k <= maxLag; n++) s += bit[n] & bit[n + k]; // Logical AND instead of multiplication, since binary vals
        acf[k] = s;
        acfValues.push(s); // push to array for visualization
    }

    // 4) Primary peak detection
    let d = minLag;
    while (d + 1 <= maxLag && acf[d] > acf[d + 1]) d++; // skip to where acf values start increasing
    let peakVal = -1, peakLag = -1;
    for (let k = d; k <= maxLag; k++) {
        console.log(`Checking Lag ${k}: 1-Bit ACF = ${acf[k]}, PeakVal = ${peakVal}`);
        if (acf[k] > peakVal) {
            peakVal = acf[k];
            peakLag = k;
        }
    }
    if (peakLag < minLag) return null;

    // ───── Sub-harmonic correction ──────────────────────────
    // Look for longer lags that have nearly as strong a peak:
    const harmonyThreshold = 0.8; // require 80% of primary peak
    let correctedLag = peakLag;
    for (let m = 2; peakLag * m <= maxLag; m++) {
        const lag2 = peakLag * m;
        if (acf[lag2] >= peakVal * harmonyThreshold) {
            // choose this sub-harmonic if within expected freq range
            correctedLag = lag2;
            break;
        }
    }
    // use correctedLag from here on
    let T0 = correctedLag;
    console.log(`T0 = ${T0}`);

    // 5) Parabolic refinement around T0
    if (T0 > minLag && T0 < maxLag) {
        const y1 = acf[T0 - 1], y2 = acf[T0], y3 = acf[T0 + 1];
        const a = (y1 + y3 - 2 * y2) / 2, b = (y3 - y1) / 2;
        if (a !== 0) T0 = T0 - b / (2 * a);
    }

    return sampleRate / T0;
}

// Continuously updates detected pitch in real time by processing audio signal.
function updatePitch(time) {
    var cycles = new Array;
    analyser.getFloatTimeDomainData(buf); // Gets time-domain data representing the raw audio waveform.
    var ac = selectedAlgorithm(buf, audioContext.sampleRate);

    if (ac == -1) { // If ac == -1 the pitch is not valid. "vague", clear display.
        detectorElem.className = "vague";
        pitchElem.innerText = "";
        noteElem.innerText = "";
        detuneElem.className = "";
        detuneAmount.innerText = "";
        currentNote = null; // if we're not getting a clear note detected, clear currentNote
    } else { // If ac != 1 a valid pitch is detected. "confident" update UI.
        detectorElem.className = "confident";
        pitch = ac;
        pitchElem.innerText = Math.round(pitch);
        var note = noteFromPitch(pitch);
        var octave = noteFromPitchWithOctave(pitch);
        currentNote = noteStrings[note % 12] + octave;
        noteElem.innerHTML = currentNote;
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
    // If metronome and note gen is on, check for correct notes
    if (isPlaying) {
        if (isCorrectNotePlayed() && !hasPlayedCorrectNoteAlready) {
            score += 1
            playDing();
        }
        else {
            console.log('You are not playing the target note');
        }
    }

    // Ensures updatePitch is repeatedly called for continous pitch deteciton.
    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = window.webkitRequestAnimationFrame; // Assigns fallback incase requestAnimationFrame not available in browser.
    rafID = window.requestAnimationFrame(updatePitch); // Calls reqAnimFram (better than setTimeout or setInterval) passing in updatePitch as the function to be executed before the next browser repaint
    // Repeatedly calls updatePitch, function is executed every frame, ensuring smooth real-time updates.
}

////////////////////////////////////////////////////////////////////////////////////////////


// Metronome functions

// Ensures click sound is loaded once and can be reused efficiently
async function loadClickSound(url) {
    const response = await fetch(url); // waits until file is fully downloaded before moving to next line. Response stores the fetched data
    const arrayBuffer = await response.arrayBuffer(); // converts file into raw binary data buffer, decodeAudioData requires this format.
    clickBuffer = await audioContext.decodeAudioData(arrayBuffer); // decodes raw binary audio data into a format Webaudo API can use.
}

// Function to schedule clicks
function scheduleClick(time) {
    if (!clickBuffer) return; // ensure click sound is loaded

    let source = audioContext.createBufferSource(); // creates an AudioBufferSourceNode, plays audio from buffer
    source.buffer = clickBuffer;
    source.connect(audioContext.destination);
    source.start(time);

    // Choose and display next target note
    targetNote = generateRandomNote(0);
    totalNotes += 1;
    document.getElementById('score').innerText = `Score: ${score}/${totalNotes}`;
    document.getElementById('target-note').innerText = `Target Note: ${targetNote}` // later make it so mode is a variable, that can change.
    hasPlayedCorrectNoteAlready = false; // reset to false
}


// need to get better ding sound, but this works for now.
function playDing() {
    let osc = audioContext.createOscillator();
    let gainNode = audioContext.createGain();

    osc.frequency.value = 1500;
    gainNode.gain.value = 0.5;

    osc.connect(gainNode);
    gainNode.connect(audioContext.destination);

    osc.start();
    osc.stop(audioContext.currentTime + 0.2);

    hasPlayedCorrectNoteAlready = true; // Mark that we've played the correct note already for this cycle
}


// Metronome scheduler
function scheduler() {
    // Schedules as many notes as fit in the schedule window. Higher bpm, more notes scheduled.
    while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
        scheduleClick(nextNoteTime);
        nextNoteTime += 60.0 / tempo;
    }

    // checks every 25ms to see if it needs to schedules the next beat.
    if (isPlaying) {
        setTimeout(scheduler, 25);
    }
}


// Start/stop
function toggleMetronome() {
    isPlaying = !isPlaying;

    // Clear target note when toggled off
    if (isPlaying == false) {
        document.getElementById('target-note').innerText = 'Target Note: ' // later make it so mode is a variable, that can change.
        document.getElementById('score').innerText = ''
    }

    if (isPlaying) {
        nextNoteTime = audioContext.currentTime;
        document.getElementById('score').innerText = `Score: ${score}/${totalNotes}`;
        scheduler();
    }
}

function generateRandomNote(mode) {
    if (mode == 0) {
        return naturalNotesArray[Math.floor(Math.random() * naturalNotesArray.length)];
    }
    else if (mode == 1) {
        return accidentalNotesArray[Math.floor(Math.random() * naturalNotesArray.length)];
    }
    else if (mode == 2) {
        return allNotesArray[Math.floor(Math.random() * allNotesArray.length)];
    }
}

// Makes Notes equal regardless of octave. A2 and A5 are equal. It's just A. A#2
function isCorrectNotePlayed() {
    let simpleTargetNote = null;
    let simpleCurrentNote = null;

    // Only check when metronome click and note gen is on, and when a note is being detected.
    if (isPlaying && currentNote) {
        if (targetNote.includes('#')) {
            simpleTargetNote = targetNote.slice(0, 2);
            console.log(`target note: ${simpleTargetNote}`);
        }
        else {
            simpleTargetNote = targetNote.slice(0, 1);
            console.log(`target note: ${simpleTargetNote}`);
        }
        if (currentNote.includes('#')) {
            simpleCurrentNote = currentNote.slice(0, 2);
            console.log(`current note: ${simpleCurrentNote}`);
        }
        else {
            simpleCurrentNote = currentNote.slice(0, 1);
            console.log(`current note: ${simpleCurrentNote}`);
        }

        if (simpleCurrentNote == simpleTargetNote) {
            return true;
        }
        else {
            return false;
        }
    }

}

async function testPitchDetection(arrayBuffer, expectedFrequency) {
    resultElem.innerHTML = "Testing...";

    // clear arrays to store waveforms at each step
    amdfValues = [];
    oneBitAmdf = [];
    acfValues = [];

    // const response = await fetch(filePath);
    // const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const monoChannel = audioBuffer.getChannelData(0);
    const sampleRate = audioContext.sampleRate;
    const bufferSize = 2048;
    let pitchDetected = -1;
    let offset = 0

    // Plot input waveform (only once, for the first slice)
    let slice = monoChannel.slice(offset, offset + bufferSize);
    if (offset === 0) {
        const timeAxis = slice.map((_, i) => i / sampleRate);
        Plotly.newPlot("waveform", [
            {
                x: timeAxis,
                y: slice,
                type: "scatter",
                name: "Input Waveform"
            }
        ], {
            title: "Input Waveform",
            xaxis: { title: "Time (s)" },
            yaxis: { title: "Amplitude" }
        });
    }

    const detectPitch = selectedAlgorithm; // Use selected pitch detection algorithm: ACF/AMDF/COMBINED
    const startTime = performance.now();
    while (offset + bufferSize < monoChannel.length) {
        slice = monoChannel.slice(offset, offset + bufferSize);

        const pitch = detectPitch(slice, sampleRate);

        if (pitch !== -1) {
            pitchDetected = pitch;
            break;
        }
        offset += bufferSize;
    }
    const durationMs = (performance.now() - startTime).toFixed(2);

    var note = noteFromPitch(pitchDetected);
    var octave = noteFromPitchWithOctave(pitchDetected);
    var detectedNote = noteStrings[note % 12] + octave;
    var expectedNote = noteStrings[noteFromPitch(expectedFrequency) % 12] + noteFromPitchWithOctave(expectedFrequency);
    var detune = Math.abs(centsOffFromPitch(pitchDetected, noteFromPitch(expectedFrequency)));

    if (pitchDetected !== -1) {
        resultElem.innerHTML = `
            🎵 <strong>Expected Pitch:</strong> ${expectedFrequency} Hz, ${expectedNote}<br>
            ✅ <strong>Detected Pitch:</strong> ${pitchDetected.toFixed(2)} Hz, ${detectedNote}<br>
            ⏱️ <strong>Computation Time:</strong> ${durationMs} ms<br>
            <strong>Detune Amount:</strong> ${detune} cents
        `;
    } else if (pitchDetected == null) {
        resultElem.innerHTML = '❌ No pitch detected.';
    } else {
        resultElem.innerHTML = '❌ No pitch detected.';
    }

    if (selectedAlgorithm == oneBitAMDF_ACF) {
        Plotly.newPlot("plot", [
            {
                y: amdfValues,
                name: "AMDF",
                type: "scatter"
            },
            {
                y: oneBitAmdf,
                name: "1-bit AMDF",
                type: "scatter"
            },
            {
                y: acfValues,
                name: "ACF of 1-bit",
                type: "scatter"
            }
        ], {
            title: "Combined AMDF and ACF",
            xaxis: { title: "Lag" },
            yaxis: { title: "Value" }
        });
    } else if (selectedAlgorithm == autoCorrelate) {
        Plotly.newPlot("plot", [
            {
                y: acfValues,
                name: "ACF",
                type: "scatter"
            }
        ], {
            title: "Autocorrelation",
            xaxis: { title: "Lag" },
            yaxis: { title: "Value" }
        });
    } else if (selectedAlgorithm == secondOptimizedAMDF) {
        Plotly.newPlot("plot", [
            {
                y: amdfValues,
                name: "AMDF",
                type: "scatter"
            }
        ], {
            title: "Average Magnitude Difference",
            xaxis: { title: "Lag" },
            yaxis: { title: "Value" }
        });
    }
}

async function handleAudioUpload() {
    const fileInput = document.getElementById("audioFile");
    const freqInput = document.getElementById("expectedFreq");
    const file = fileInput.files[0];
    const expectedFrequency = parseFloat(freqInput.value);

    if (!file) {
        alert("Please upload an audio file.");
        return;
    }

    if (isNaN(expectedFrequency) || expectedFrequency <= 0) {
        alert("Please enter a valid expected frequency.");
        return;
    }

    const arrayBuffer = await file.arrayBuffer();
    testPitchDetection(arrayBuffer, expectedFrequency);
}


loadClickSound("Perc_Clap_lo.wav");

document.getElementById("algorithmSelect").addEventListener("change", (e) => {
    selectedAlgorithm = pitchAlgorithms[e.target.value]; // Use selected pitch detection algorithm: ACF/AMDF/COMBINED.
});

var start_live_button = document.getElementById('toggleLive');
start_live_button.addEventListener("click", toggleLiveInput)

var start_game_button = document.getElementById('start-button'); // Toggle the metronome and target note generation
start_game_button.addEventListener("click", toggleMetronome)

const resultElem = document.getElementById('result');

document.getElementById('fileUpload').addEventListener("click", handleAudioUpload);
