import { browser } from '$app/environment';

type FirebaseConfig = {
  apiKey?: string;
  appId?: string;
  authDomain?: string;
  messagingSenderId?: string;
  projectId?: string;
  storageBucket?: string;
};

const firebaseConfig: FirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
};

export function hasFirebaseConfig(): boolean {
  return Boolean(browser && firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId);
}

export async function getZenithFirestore() {
  if (!hasFirebaseConfig()) return null;

  const [{ getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore')
  ]);
  const existing = getApps().find((app) => app.name === 'zenith');
  const app = existing ?? initializeApp(firebaseConfig, 'zenith');

  return getFirestore(app);
}
