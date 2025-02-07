import Wad from 'web-audio-daw';
// import { toggleMetronome, loadClickSound } from './metronome.js';
import { allNotesArray, naturalNotesArray } from './constants';
// Global reference to the tuner and mic
let tuner = null;
let mic = null;
let targetNote = null; // correct target note
let currentNote = null; // store the note currently being detected by mic
let isListening = false;

// metronome stuff

let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let isPlaying = false; // Tracks whether the metronome is running
let tempo = 40.0; // BPM
let nextNoteTime = 0.0; // When the next click should be scheduled
let scheduleAheadTime = 0.1; // How far ahead to schedule audio (in seconds)
let clickBuffer = null; // store the metronome click audio file


// Makes Notes equal regardless of octave. A2 and A5 are equal. It's just A. A#2
function isCorrectNotePlayed() {
    let simpleTargetNote = null;
    let simpleCurrentNote = null;
    if (targetNote.includes('#')) {
        simpleTargetNote = targetNote.slice(0, 2);
    }
    else {
        simpleTargetNote = targetNote.slice(0, 1);
    }
    if (currentNote.includes('#')) {
        simpleCurrentNote = currentNote.slice(0, 2);
    }
    else {
        simpleCurrentNote = currentNote.slice(0, 1);
    }

    if (simpleCurrentNote == simpleTargetNote) {
        return true;
    }
    else {
        return false;
    }

}

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
    // targetNote = 'A2';
    targetNote = generateRandomNote(0);
    document.getElementById('target-note').innerText = `Target Note: ${targetNote}` // later make it so mode is a variable, that can change.

    // If correct note is played, ding
    // TODO: Have bool variable that stores whether the correct note has been played in this time window. If not, X, otherwise, ding.
    if (isCorrectNotePlayed()) {
        playDing();
    }
    else {
        console.log('You are not playing the target note');
    }
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


// main app stuff

function startListening() {
    console.log("starting to listen");
    isListening = true;
    // document.getElementById('start-button').textContent = 'Stop';

    // Create a Wad instance for the microphone only first time.
    // After we just reuse the same instances for mic/tuner.
    if (!mic) {
        mic = new Wad({ source: 'mic' });
    }

    // Create a PolyWad to analyze pitch
    if (!tuner) {
        tuner = new Wad.Poly();
        // tuner.setVolume(0); // mute feedback
        tuner.add(mic);
    }

    // Start listening to the microphone
    mic.play();

    // Analyze pitch
    tuner.updatePitch();
    document.getElementById('your-note').textContent = 'Listening...';

    // Continuously check pitch
    function detectPitch() {
        if (!isListening) return;

        // const currentPitch = tuner.pitch;
        const noteName = tuner.noteName || '--'; // Use '--' if no note detected
        currentNote = noteName // store current note being played to be exported into metronome

        // Update the displayed note
        document.getElementById('your-note').textContent = `Your Note: ${noteName}`;

        // Repeat detection
        requestAnimationFrame(detectPitch);
    }

    detectPitch();
}


function stopListening() {
    isListening = false;
    document.getElementById('start-button').textContent = 'Start'

    // Clean up references
    if (mic) {
        mic.stop();
    }
    if (tuner) {
        tuner.stopUpdatingPitch(); // Stop calculating the pitch if you don't need to know it anymore.
        tuner.stop();
    }

    // Reset the displayed note
    document.getElementById('your-note').textContent = 'Your Note: --';
    document.getElementById('target-note').textContent = 'Target Note: --';
}

function startCountdown(seconds) {
    let time = seconds

    let countdown = setInterval(() => {
        console.log(time);
        time -= 1;

        if (time <= 0) {
            clearInterval(countdown);
        }
    }, 1000);
}

// Toggle mic on/off
function toggleListening() {
    if (!isListening) {
        document.getElementById('start-button').textContent = 'Stop';
        // Maybe later add a countdown so user knows it worked.
        setTimeout(startListening, 3000);
        setTimeout(toggleMetronome, 3000);
    }
    else {
        stopListening();
        toggleMetronome();
    }
    // toggleMetronome(); // turn metronome on/off
}


// TODO: Make it so it picks a different string and note each time. No repeats
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

loadClickSound("Perc_Clap_lo.wav");

// Attach event listeners
document.getElementById('start-button').addEventListener('click', toggleListening);
