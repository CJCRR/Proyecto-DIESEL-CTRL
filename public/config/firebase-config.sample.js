import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Copie este archivo a firebase-config.js y reemplace los valores

const firebaseConfig = {
  apiKey: "REEMPLAZAR_API_KEY",
  authDomain: "REEMPLAZAR_PROJECT.firebaseapp.com",
  projectId: "REEMPLAZAR_PROJECT",
  storageBucket: "REEMPLAZAR_BUCKET",
  messagingSenderId: "REEMPLAZAR_SENDER_ID",
  appId: "REEMPLAZAR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc };
