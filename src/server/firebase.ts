// src/server/firebase.ts
import admin from "firebase-admin";
import serviceAccount from "./firebase-key.json"; // Make sure `resolveJsonModule` is true in tsconfig.json

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

// Export Firestore as default
const db = admin.firestore();
export default db;
