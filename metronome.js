import { getCurrentNote } from './app.js';

let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let isPlaying = false; // Tracks whether the metronome is running
let tempo = 80.0; // BPM
let nextNoteTime = 0.0; // When the next click should be scheduled
let scheduleAheadTime = 0.1; // How far ahead to schedule audio (in seconds)
let clickBuffer = null; // store the metronome click audio file

// Ensures click sound is loaded once and can be reused efficiently
async function loadClickSound(url) {
    const response = await fetch(url); // waits until file is fully downloaded before moving to next line. Response stores the fetched data
    const arrayBuffer = await response.arrayBuffer(); // converts file into raw binary data buffer, decodeAudioData requires this format.
    clickBuffer = await audioContext.decodeAudioData(arrayBuffer); // decodes raw binary audio data into a format Webaudo API can use.
}

function checkCurrentNote() {
    const currentNote = getCurrentNote();
    console.log(`Current Node: ${currentNote}`);
}

// Function to schedule clicks
function scheduleClick(time) {
    // let osc = audioContext.createOscillator();
    // let gainNode = audioContext.createGain();
    //
    // osc.frequency.value = 1000; // Click sound frequency
    // gainNode.gain.value = 0.5; // Click volume
    //
    // osc.connect(gainNode);
    // gainNode.connect(audioContext.destination);

    // Schedules the sound to start and stop ahead of time.
    // osc.start(time);
    // osc.stop(time + 0.05);

    if (!clickBuffer) return; // ensure click sound is loaded

    let source = audioContext.createBufferSource(); // creates an AudioBufferSourceNode, plays audio from buffer
    source.buffer = clickBuffer;
    source.connect(audioContext.destination);
    source.start(time);
    checkCurrentNote();
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

    if (isPlaying) {
        nextNoteTime = audioContext.currentTime;
        scheduler();
    }
}

export { toggleMetronome, loadClickSound, tempo };

