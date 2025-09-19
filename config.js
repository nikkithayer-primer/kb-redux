// Firebase configuration and initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBREXIfdErDgX_Bl2EEE8EwO6NMIlzb_BE",
    authDomain: "knowledge-base-db.firebaseapp.com",
    projectId: "knowledge-base-db",
    storageBucket: "knowledge-base-db.firebasestorage.app",
    messagingSenderId: "430506616488",
    appId: "1:430506616488:web:58029038d09e00d9f7849d"
};

// Initialize Firebase
let app;
let db;

try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

export { db, app };
