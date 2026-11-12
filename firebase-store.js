import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { Bytes, collection, doc, getDocFromServer, getDocsFromServer, getFirestore, runTransaction } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

const chunkSize = 768 * 1024;
const maxFileSize = 5 * 1024 * 1024;

export function createCentralStore(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const items = collection(db, 'centralItems');
  const attachmentParts = (item) => collection(item, 'attachmentParts');

  async function currentUser() {
    await auth.authStateReady();
    const account = auth.currentUser;
    if (!account) return null;
    if (!account.emailVerified || !account.email) {
      throw new Error('Entre com uma conta Google com e-mail verificado.');
    }
    const email = account.email.toLowerCase();
    const entry = await getDocFromServer(doc(db, 'centralMembers', email));
    if (!entry.exists() || !['member', 'admin'].includes(entry.data().role)) {
      throw new Error('Esta conta Google não tem acesso à Central Revenue.');
    }
    return { id: account.uid, email, name: account.displayName || email, role: entry.data().role };
  }

  async function saveItem(id, fields, file) {
    const item = id ? doc(items, id) : doc(items);
    if (file && (!file.size || file.size > maxFileSize)) {
      throw new Error('Selecione um arquivo com até 5 MB.');
    }
    const fileId = file ? crypto.randomUUID() : '';
    const chunks = [];
    if (file) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        chunks.push(Bytes.fromUint8Array(buffer.slice(offset, offset + chunkSize)));
      }
    }

    await runTransaction(db, async (transaction) => {
      const previous = id ? (await transaction.get(item)).data() : undefined;
      if (id && !previous) throw new Error('Este conteúdo já foi removido.');
      const isDocument = fields.type === 'document';
      const keepingFile = isDocument && !file;
      const next = {
        ...fields,
        fileId: isDocument ? fileId || previous?.fileId || '' : '',
        fileName: isDocument ? file?.name || previous?.fileName || '' : '',
        fileParts: keepingFile ? previous?.fileParts || 0 : chunks.length,
        active: true,
        createdAt: previous?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (isDocument && !next.fileId) throw new Error('Selecione um anexo.');
      if (!keepingFile) {
        for (const [index, bytes] of chunks.entries()) {
          transaction.set(doc(attachmentParts(item), String(index)), { fileId, index, bytes });
        }
        for (let index = chunks.length; index < (previous?.fileParts || 0); index++) {
          transaction.delete(doc(attachmentParts(item), String(index)));
        }
      }
      transaction.set(item, next);
    });
  }

  async function removeItem(id) {
    const item = doc(items, id);
    await runTransaction(db, async (transaction) => {
      const current = await transaction.get(item);
      if (!current.exists()) return;
      for (let index = 0; index < current.data().fileParts; index++) {
        transaction.delete(doc(attachmentParts(item), String(index)));
      }
      transaction.delete(item);
    });
  }

  async function download(item) {
    const snapshot = await getDocsFromServer(attachmentParts(doc(items, item.id)));
    const parts = snapshot.docs.map((entry) => entry.data()).sort((a, b) => a.index - b.index);
    if (parts.length !== item.fileParts || parts.some((part, index) => part.fileId !== item.fileId || part.index !== index)) {
      throw new Error('O anexo foi alterado. Atualize a lista e tente novamente.');
    }
    return new Blob(parts.map((part) => part.bytes.toUint8Array()));
  }

  return {
    currentUser,
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      return currentUser();
    },
    signOut: () => signOut(auth),
    async listItems() {
      const snapshot = await getDocsFromServer(items);
      return snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
    },
    saveItem,
    removeItem,
    download,
  };
}
