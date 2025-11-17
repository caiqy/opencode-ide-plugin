import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import { ideBridge } from "./lib/ideBridge"
import { SessionProvider } from "./state/SessionContext.tsx"
import { ToastProvider } from "./state/ToastContext.tsx"
import { ErrorBoundary } from "./components/ErrorBoundary.tsx"
import { ProjectProvider } from "./state/ProjectContext.tsx"
import { IdeBridgeProvider } from "./state/IdeBridgeContext"
import { initGlobalDnD } from "./lib/dnd"

ideBridge.init()
initGlobalDnD()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ProjectProvider>
        <SessionProvider>
          <ToastProvider>
            <IdeBridgeProvider>
              <App />
            </IdeBridgeProvider>
          </ToastProvider>
        </SessionProvider>
      </ProjectProvider>
    </ErrorBoundary>
  </StrictMode>,
)
