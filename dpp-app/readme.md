\# dpp-app — Derivatives Portfolio Pricer (AWS Deployment App)



This folder contains the deployable application for my Derivatives Portfolio Pricer AWS project. It includes:



\- \*\*UI\*\*: Static HTML/CSS/JS pages for running Monte Carlo option pricing and basic portfolio workflows.

\- \*\*API\*\*: An ASP.NET API that receives simulation requests and returns pricing results.



\## Deployment model (EC2)



The production setup uses \*\*Nginx as the single entry point\*\*:



\- `/` serves the static UI files (HTML/CSS/JS).

\- `/api/\*` is reverse-proxied by Nginx to the ASP.NET API running in \*\*Docker\*\* on an internal host port (planned: `127.0.0.1:5022`).



This keeps everything under one base URL, avoids CORS issues, and prevents exposing the API container port directly to the internet.



\## Key paths



\- UI: `dpp-app/MCSimulator/MonteCarloSimulatorWebApp/`

\- API: `dpp-app/MCSimulator/MonteCarloSimulatorAPI/`

\- Nginx config: `dpp-app/infra/nginx/dpp.conf`



\## Notes



\- The UI should call the API through a relative base path: `BASE\_URL = "/api"`.

\- The API host port used by Docker must match the Nginx `proxy\_pass` port.



