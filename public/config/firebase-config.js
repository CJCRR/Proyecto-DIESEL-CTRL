import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC_WE5N-zcvm-hSr7ZTJyb3tSePamuAFvY",
    authDomain: "diesel-ctrl.firebaseapp.com",
    projectId: "diesel-ctrl",
    storageBucket: "diesel-ctrl.firebasestorage.app",
    messagingSenderId: "148054872682",
    appId: "1:148054872682:web:1c366170c13fccb1b67013"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc };