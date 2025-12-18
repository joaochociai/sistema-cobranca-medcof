// js/auth.js
import { auth } from "../firebase.js";
import { 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    setPersistence, 
    browserSessionPersistence 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { getUserPermissions } from "../permissions.js";
import { showMenusByPermission, loadModulesBySector } from "../ui.js";

window.currentUser = null;

document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value;
    const pass  = document.getElementById("login-password").value;

    try {
        await setPersistence(auth, browserSessionPersistence);

        const cred = await signInWithEmailAndPassword(auth, email, pass);
        console.log("Login OK:", cred.user.uid);
        
    } catch (e) {
        console.error(e); // É bom logar o erro para saber o que houve
        document.getElementById("login-message").textContent = "E-mail ou senha inválidos.";
    }
});

// Auto login listener
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        document.getElementById("login-screen").style.display = "flex";
        document.getElementById("app-content").style.display = "none";
        return;
    }

    // Se o usuário já estiver logado (ex: deu F5 na página), o fluxo segue aqui
    const perms = await getUserPermissions(user.uid);
    window.currentUser = perms;

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-content").style.display = "block";

    showMenusByPermission(perms);
    loadModulesBySector(perms);
});

// Logout
window.logoutSystem = function() {
    signOut(auth);
};