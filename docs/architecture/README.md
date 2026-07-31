# PINIT Architecture Documentation

Complete system architecture for the PINIT-DNA / PinIT Hub monorepo (Express + React + Python AI + extension + Prisma), derived from the current codebase.

| # | File | Purpose |
|---|------|---------|
| 01 | [01_Project_Overview.md](./01_Project_Overview.md) | Purpose, modules, stack, deployment overview |
| 02 | [02_System_Architecture.md](./02_System_Architecture.md) | Monolithic layered architecture + flows |
| 03 | [03_Folder_Structure.md](./03_Folder_Structure.md) | Folder-by-folder map |
| 04 | [04_Backend_Architecture.md](./04_Backend_Architecture.md) | Express startup, routes, services, config |
| 05 | [05_Frontend_Architecture.md](./05_Frontend_Architecture.md) | React SPA structure, auth, state |
| 06 | [06_Database_Architecture.md](./06_Database_Architecture.md) | ER, keys, indexes, migrations |
| 07 | [07_API_Documentation.md](./07_API_Documentation.md) | Endpoint inventory |
| 08 | [08_Request_Flow.md](./08_Request_Flow.md) | Request lifecycle diagrams |
| 09 | [09_Security_Architecture.md](./09_Security_Architecture.md) | AuthZ, JWT, encryption, CORS, etc. |
| 10 | [10_Deployment_Architecture.md](./10_Deployment_Architecture.md) | Dev/prod, Render, Vercel, Docker |
| 11 | [11_Component_Diagrams.md](./11_Component_Diagrams.md) | Mermaid component views |
| 12 | [12_Sequence_Diagrams.md](./12_Sequence_Diagrams.md) | Login, upload, share, search, … |
| 13 | [13_Class_Diagrams.md](./13_Class_Diagrams.md) | UML-style module diagrams |
| 14 | [14_Developer_Guide.md](./14_Developer_Guide.md) | Onboarding & how to run |
| 15 | [15_Tech_Stack.md](./15_Tech_Stack.md) | Languages, libraries, services |

**Documentation rules:** only document what exists in code; state **Not implemented in current codebase** when absent (e.g. SMTP, Redis, formal Repository/DTO layers, dedicated staging).
