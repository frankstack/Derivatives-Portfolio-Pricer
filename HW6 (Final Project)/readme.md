
# Derivatives-Portfolio-Pricer ( “HW6 – Final Project” )

A self-contained demo platform for **pricing and managing an options portfolio with Monte-Carlo simulation**.
It consists of:

| Layer             | Folder                                  | Tech                                  | Purpose                                                                                                                                       |
| ----------------- | --------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **REST API**      | `MCSimulator/MonteCarloSimulatorAPI`    | ASP .NET 8 (Web API), EF Core, Npgsql | CRUD for underlyings, options, trades and rate-curves plus a valuation endpoint that runs a MC engine and returns price + Greeks.             |
| **Static web UI** | `MCSimulator/MonteCarloSimulatorWebApp` | HTML/CSS, Vanilla JS, Chart.js        | Single-page interface (Portfolio Manager) that consumes the API, shows tables & charts and lets you drive the whole workflow without Postman. |
| (DB)              | —                                       | PostgreSQL                            | Stores instruments, trades, historical prices and yield curves.                                                                               |

---

### 1 . Quick start

```bash
# prerequisites
dotnet --version      # 8.x
psql --version        # PostgreSQL ≥ 15 (or use Docker)

# clone & restore
git clone https://github.com/frankstack/Derivatives-Portfolio-Pricer.git
cd Derivatives-Portfolio-Pricer/HW6\ \(Final\ Project\)

# 1) set your connection string in
#    MCSimulator/MonteCarloSimulatorAPI/appsettings.Development.json
#    e.g.  "Host=localhost;Port=5432;Database=mc_sim;Username=postgres;Password=mysecret"

# 2) create schema & seed tables
dotnet ef --project MCSimulator/MonteCarloSimulatorAPI database update

# 3) run the API
dotnet run --project MCSimulator/MonteCarloSimulatorAPI
# → listening on http://localhost:5022  (adjusted in Properties/launchSettings.json)

# 4) open the UI
#    a) easiest: move MonteCarloSimulatorWebApp into API/wwwroot   OR
#    b) serve it from the filesystem:
#       npx serve -s MCSimulator/MonteCarloSimulatorWebApp 5500
#       then browse to http://localhost:5500/portfolioManager.html
```

---

### 2 . Using the system

| Step                     | What to do                                                                         | Sample payload                                                                                                                                                                              |                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create an underlying** | `POST /api/Underlyings`                                                            | `json { "symbol":"AAPL", "name":"Apple Inc.", "historicalPrices":[ { "date":"2025-01-06T00:00:00Z","price":192.00 }, … ] } `                                                                |                                                                                                                                                                                               |
| **Create an option**     | `POST /api/OptionEntities`                                                         | European call                                                                                                                                                                               | `json { "symbol":"AAPL_C_250_JUN", "name":"Jun25 $250 Call", "strikePrice":250, "expirationDate":"2025-06-20T00:00:00Z", "optionStyle":1, "isCall":true, "underlyingId":1, "optionType":1 } ` |
| **Create a trade**       | `POST /api/Trades`                                                                 | `json { "instrumentId":2, "quantity":10, "tradeDate":"2025-02-01T00:00:00Z", "price":12.35 } `                                                                                              |                                                                                                                                                                                               |
| **Build a yield curve**  | `POST /api/RateCurves` → returns **ID 1** then `POST /api/RateCurves/1/RatePoints` | `json [ {"tenor":0.25,"rate":0.048}, {"tenor":1,"rate":0.051}, {"tenor":5,"rate":0.057} ] `                                                                                                 |                                                                                                                                                                                               |
| **Run a valuation**      | `POST /api/Valuation`                                                              | `json { "tradeIds":[1], "steps":252, "simulations":50000, "antithetic":true, "controlVariate":true, "multithreaded":true, "useVDCSequence":false, "base1":2, "base2":3, "rateCurveId":1 } ` |                                                                                                                                                                                               |

All of this can be done graphically in **Swagger** (`http://localhost:5022/swagger`) or the **PortfolioManager.html** SPA.

---

### 3 . API map (REST vocabulary)

| Resource (controller) | Route prefix                                | What it models                                                                 |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| **Underlyings**       | `/api/Underlyings`                          | Equity or FX spot asset + its historical prices                                |
| **OptionEntities**    | `/api/OptionEntities`                       | Asian, Barrier, Digital, European, Look-back & Range options (DTO inheritance) |
| **Trades**            | `/api/Trades`                               | Position entries for portfolio valuation                                       |
| **RateCurves**        | `/api/RateCurves` + `/RatePoints` sub-route | Piecewise-linear term structure used for discounting / drift                   |
| **Valuation**         | `/api/Valuation`                            | Runs Monte-Carlo and returns price, s.e. and the five Greeks                   |

Each resource supports the conventional HTTP verbs:

* **GET** (collection or `{id}`) – read
* **POST** (collection) – create
* **PUT** `{id}` – replace/update
* **DELETE** `{id}` – remove

---

### 4 . Project structure

```
MCSimulator/
 ├── MonteCarloSimulatorAPI/      # C# Web-API + Models + MC engine
 │    ├── Controllers/
 │    ├── Data/                   # EF Core DbContext & Migrations
 │    └── Services/MonteCarlo/…
 ├── MonteCarloSimulatorWebApp/   # Static front-end (HTML/CSS/JS)
 │    ├── portfolioManager.html
 │    ├── portfolioManager.css
 │    └── portfolioManager.js
 └── README.md (this file)
```

---

### 5 . Tech stack

* **C# / ASP .NET 8** minimal-API style
* **Entity Framework Core 8** + **PostgreSQL** (Npgsql)
* **JavaScript** (no framework) + **Chart.js 4** for plotting
* **Swagger / Swashbuckle** for interactive API docs
* Monte-Carlo engine (antithetic, control-variate, Van-der-Corput, multi-threading)

---

### 6 . Notes & tips

* Dates sent to the API **must be UTC or have the “Z” suffix** (`2025-05-16T00:00:00Z`).
  The DB column is `timestamptz`; a naive `DateTime` will be rejected by Npgsql.
* The SPA issues relative fetches (`/api/…`). Serve it **through the same origin** as the API or hard-code `BASE_URL`.
* If you need to reset the DB:

  ```bash
  dotnet ef database drop -f && dotnet ef database update
  ```
* For quick static hosting during dev:

  ```bash
  npx serve -s MonteCarloSimulatorWebApp 5500
  ```

Happy pricing!
