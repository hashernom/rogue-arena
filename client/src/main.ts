import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <h1>Rogue Arena 🎮</h1>
  <div class="card">
    <p>Monorepo configurado correctamente</p>
    <p>Cliente: Vite + TypeScript + Three.js</p>
    <p>Servidor: Node.js + Socket.io</p>
    <p>Compartido: Tipos TypeScript</p>
  </div>
  <p class="read-the-docs">
    Ejecuta <code>pnpm dev</code> para iniciar desarrollo
  </p>
`