import Wad from 'web-audio-daw';
import { toggleMetronome, loadClickSound } from './metronome.js';

// Global reference to the tuner and mic
let tuner = null;
let mic = null;
let currentNote = null; // store the note currently being detected by mic
let isListening = false;
const naturalNotes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const accidentalNotes = [
    "C#", "Db",
    "D#", "Eb",
    "E#", "Fb",
    "F#", "Gb",
    "G#", "Ab",
    "A#", "Bb",
    "B#", "Cb"
];
const allNotes = [
    "C", "C#", "Db",
    "D", "D#", "Eb",
    "E", "E#", "Fb",
    "F", "F#", "Gb",
    "G", "G#", "Ab",
    "A", "A#", "Bb",
    "B", "B#", "Cb"
];

function updatePitch() {
    currentNote = tuner.noteName;
}


function startListening() {
    isListening = true;
    document.getElementById('start-button').textContent = 'Stop';

    // Create a Wad instance for the microphone only first time.
    // After we just reuse the same instances for mic/tuner.
    if (!mic) {
        mic = new Wad({ source: 'mic' });
    }

    // Create a PolyWad to analyze pitch
    if (!tuner) {
        tuner = new Wad.Poly();
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
        // console.log(currentNote);
        // updatePitch();

        // Update the displayed note
        document.getElementById('your-note').textContent = `Note: ${noteName}`;

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
        //mic = null;
    }
    if (tuner) {
        tuner.stopUpdatingPitch(); // Stop calculating the pitch if you don't need to know it anymore.
        tuner.stop();
        //tuner = null;
    }

    // Reset the displayed note
    document.getElementById('your-note').textContent = 'Note: --';
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
        // startCountdown(3, countdown_text);
        startListening();
    }
    else {
        stopListening();
    }
    toggleMetronome(); // turn metronome on/off
}


function generateRandomNote(mode) {
    if (mode == 0) {
        return naturalNotes[Math.floor(Math.random() * naturalNotes.length)];
    }
    else if (mode == 1) {
        return accidentalNotes[Math.floor(Math.random() * naturalNotes.length)];
    }
    else if (mode == 2) {
        return allNotes[Math.floor(Math.random() * naturalNotes.length)];
    }
}

loadClickSound("Perc_Clap_lo.wav");

// Attach event listeners
document.getElementById('start-button').addEventListener('click', toggleListening);
let countdown_text = document.getElementById('countdown')

export function getCurrentNote() {
    return currentNote;
}
