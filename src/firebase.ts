import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, remove, off, onDisconnect, type DatabaseReference } from 'firebase/database';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

// ========================================
// Firebase 設定
// Firebase Console → プロジェクトの設定 → マイアプリ から取得した値を入力してください
// ========================================
const firebaseConfig = {
  apiKey: "AIzaSyDrMKHJaOZ74irPuVYRji-faCdSlGmlb2E",
  authDomain: "niigata-sake-no-jin-26.firebaseapp.com",
  databaseURL: "https://niigata-sake-no-jin-26-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "niigata-sake-no-jin-26",
  storageBucket: "niigata-sake-no-jin-26.firebasestorage.app",
  messagingSenderId: "482488531672",
  appId: "1:482488531672:web:9e807a971085c85fb3f5ad"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Types ---
export interface FirebaseGroupMember {
  name: string;
  wants: string[]; // booth numbers
  updatedAt: number;
}

// --- Helper: get or create a persistent member ID ---
const MEMBER_ID_KEY = 'sakenojin-member-id';
export function getMyMemberId(): string {
  let id = localStorage.getItem(MEMBER_ID_KEY);
  if (!id) {
    id = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(MEMBER_ID_KEY, id);
  }
  return id;
}

/** Override my member ID (for re-linking to an existing entry) */
export function setMyMemberId(newId: string): void {
  localStorage.setItem(MEMBER_ID_KEY, newId);
}

// --- Group operations ---

/** Write my data to a group */
export function syncMyDataToGroup(
  groupId: string,
  memberId: string,
  name: string,
  wants: string[]
): Promise<void> {
  const memberRef = ref(db, `groups/${groupId}/members/${memberId}`);
  return set(memberRef, {
    name,
    wants,
    updatedAt: Date.now()
  });
}

/** Subscribe to all members in a group. Returns an unsubscribe function. */
export function subscribeToGroup(
  groupId: string,
  callback: (members: Record<string, FirebaseGroupMember>) => void,
  onError?: (error: Error) => void
): () => void {
  const groupRef: DatabaseReference = ref(db, `groups/${groupId}/members`);
  const unsubscribe = onValue(groupRef, (snapshot) => {
    const val = snapshot.val();
    callback(val || {});
  }, (error) => {
    onError?.(error);
  });
  return () => off(groupRef, 'value', unsubscribe);
}

/** Subscribe to Firebase connection state */
export function subscribeToConnectionState(
  callback: (status: ConnectionStatus) => void
): () => void {
  const connectedRef = ref(db, '.info/connected');
  const unsubscribe = onValue(connectedRef, (snap) => {
    callback(snap.val() === true ? 'connected' : 'disconnected');
  });
  return () => off(connectedRef, 'value', unsubscribe);
}

/** Remove a member from a group (myself or others) */
export function leaveGroup(groupId: string, memberId: string): Promise<void> {
  const memberRef = ref(db, `groups/${groupId}/members/${memberId}`);
  return remove(memberRef);
}

/** Set up onDisconnect to auto-remove my data when connection is lost */
export function setupOnDisconnect(groupId: string, memberId: string): void {
  const memberRef = ref(db, `groups/${groupId}/members/${memberId}`);
  onDisconnect(memberRef).remove();
}

/** Cancel onDisconnect (e.g. when manually leaving) */
export function cancelOnDisconnect(groupId: string, memberId: string): void {
  const memberRef = ref(db, `groups/${groupId}/members/${memberId}`);
  onDisconnect(memberRef).cancel();
}

/** Check if Firebase is configured (not placeholder) */
export function isFirebaseConfigured(): boolean {
  return !firebaseConfig.apiKey.startsWith('YOUR_');
}
