# OpenSea Print Server

Aplicativo desktop (Electron) que conecta impressoras locais ao OpenSea ERP via WebSocket. Permite imprimir etiquetas, recibos e documentos diretamente do navegador, sem necessidade de drivers ou configuracoes especiais no servidor.

## Pre-requisitos

- Node.js 20+
- npm 10+

## Setup de Desenvolvimento

```bash
# Instalar dependencias
npm ci

# Iniciar em modo desenvolvimento (main + renderer em paralelo)
npm run dev
```

O modo `dev` utiliza `concurrently` para compilar o processo main (TypeScript) e o renderer (Vite + React) simultaneamente.

## Comandos de Build

```bash
# Build completo (renderer + main)
npm run build

# Empacotar sem gerar instalador (para teste)
npm run pack

# Gerar instalador para a plataforma atual
npm run dist

# Gerar para plataforma especifica
npm run dist:win      # Windows (NSIS x64)
npm run dist:mac      # macOS (DMG x64 + arm64)
npm run dist:linux    # Linux (AppImage x64)
```

Os artefatos sao gerados na pasta `release/`.

## Processo de Release

O projeto utiliza GitHub Actions para build automatizado em todas as plataformas. Para criar uma nova release:

```bash
# Atualizar a versao no package.json
npm version patch   # ou minor / major

# Enviar a tag para o GitHub
git push origin main --tags
```

O workflow sera acionado automaticamente pela tag `v*`, compilando para Windows, macOS e Linux em paralelo. Ao final, uma GitHub Release e criada com todos os instaladores anexados.

Para disparar o build manualmente (sem criar release), utilize o botao "Run workflow" na aba Actions do repositorio.

## Arquitetura

```
OpenSea-PrintServer/
├── src/
│   ├── main/           # Processo principal Electron
│   │   ├── main.ts     # Entry point, janela, tray, auto-launch
│   │   ├── printer.ts  # Deteccao e gerenciamento de impressoras
│   │   └── ws.ts       # Servidor WebSocket (recebe jobs do OpenSea)
│   └── renderer/       # Interface React (configuracao, status)
│       ├── App.tsx
│       └── ...
├── assets/             # Icones para cada plataforma
├── dist/               # Build compilado (gitignored)
├── release/            # Instaladores gerados (gitignored)
├── vite.config.ts      # Config Vite (renderer)
├── tsconfig.json       # Config TS (renderer)
└── tsconfig.main.json  # Config TS (main process)
```

### Fluxo de Funcionamento

1. O aplicativo inicia minimizado na bandeja do sistema (system tray)
2. Um servidor WebSocket local e iniciado (porta configuravel)
3. O OpenSea APP (navegador) conecta ao WebSocket local
4. Quando o usuario solicita uma impressao no OpenSea, o job e enviado via WebSocket
5. O Print Server recebe o job e envia para a impressora selecionada
6. O status da impressao e retornado ao navegador

### Tecnologias

| Componente | Tecnologia |
|------------|-----------|
| Runtime | Electron 33 |
| Frontend | React 19 + TailwindCSS 4 |
| Build Tool | Vite 6 |
| WebSocket | ws 8 |
| Auto-update | electron-updater |
| Persistencia | electron-store |
| Auto-iniciar | auto-launch |
| Empacotamento | electron-builder 25 |

## Licenca

Proprietario - OpenSea ERP.
