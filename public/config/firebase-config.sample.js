import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Copie este archivo a firebase-config.js y reemplace los valores

const firebaseConfig = {
  apiKey: "REEMPLAZAR_API_KEY",
  authDomain: "REEMPLAZAR_PROJECT.firebaseapp.com",
  projectId: "REEMPLAZAR_PROJECT",
  storageBucket: "REEMPLAZAR_BUCKET",
  messagingSenderId: "REEMPLAZAR_SENDER_ID",
  appId: "REEMPLAZAR_APP_ID"
};

const hasRealFirebaseConfig = Object.values(firebaseConfig).every((value) => {
  return typeof value === "string" && value.trim() && !value.startsWith("REEMPLAZAR");
});

const app = hasRealFirebaseConfig
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
const db = app ? getFirestore(app) : null;

export { firebaseConfig, hasRealFirebaseConfig, db, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc, setDoc };
