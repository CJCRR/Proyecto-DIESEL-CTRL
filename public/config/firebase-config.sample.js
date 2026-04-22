import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Copie este archivo a firebase-config.js y reemplace los valores

const firebaseConfig = {
  apiKey: "AIzaSyC_WE5N-zcvm-hSr7ZTJyb3tSePamuAFvY",
  authDomain: "diesel-ctrl.firebaseapp.com",
  projectId: "diesel-ctrl",
  storageBucket: "diesel-ctrl.firebasestorage.app",
  messagingSenderId: "148054872682",
  appId: "1:148054872682:web:1c366170c13fccb1b67013"
};

const hasRealFirebaseConfig = Object.values(firebaseConfig).every((value) => {
  return typeof value === "string" && value.trim() && !value.startsWith("REEMPLAZAR");
});

const app = hasRealFirebaseConfig
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
const db = app ? getFirestore(app) : null;

export { firebaseConfig, hasRealFirebaseConfig, db, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc, setDoc };
