```markdown
# Monte Carlo Simulator

An integrated project consisting of an ASP.NET Core Web API and a JavaScript-based Web Application for pricing various types of options using Monte Carlo simulation. The API allows remote access and integration, while the Web App provides a user-friendly interface for interacting with the simulator.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [Clone the Repository](#clone-the-repository)
  - [Setup the API](#setup-the-api)
  - [Setup the Web Application](#setup-the-web-application)
- [Running the Application](#running-the-application)
  - [Run the API](#run-the-api)
  - [Run the Web Application](#run-the-web-application)
- [API Documentation](#api-documentation)
- [Web Application Usage](#web-application-usage)
- [Usage Example](#usage-example)
  - [Using the Web Application](#using-the-web-application)
  - [Using Postman](#using-postman)
- [License](#license)

## Prerequisites

Ensure you have the following installed on your system:

- [.NET 6.0 SDK or later](https://dotnet.microsoft.com/download)
- [Visual Studio Code](https://code.visualstudio.com/) with the C# extension
- [Node.js](https://nodejs.org/) (optional, for serving the Web App)
- [Postman](https://www.postman.com/downloads/) (optional, for testing)

## Setup

### Clone the Repository

```bash
git clone https://github.com/yourusername/MonteCarloSimulator.git
cd MonteCarloSimulator
```

### Setup the API

1. **Navigate to the API Directory**

    ```bash
    cd MonteCarloSimulatorAPI
    ```

2. **Restore Dependencies**

    ```bash
    dotnet restore
    ```

3. **Build the Project**

    ```bash
    dotnet build
    ```

4. **Install Swashbuckle Annotations**

    ```bash
    dotnet add package Swashbuckle.AspNetCore.Annotations
    ```

5. **Ensure CORS is Enabled**

    The `Program.cs` is already configured to enable CORS.

### Setup the Web Application

1. **Navigate to the Web App Directory**

    ```bash
    cd ../MonteCarloSimulatorWebApp
    ```

2. **No Dependencies Required**

    The Web App is built with plain HTML, CSS, and JavaScript. No additional setup is needed unless you choose to serve it using a local server.

## Running the Application

### Run the API

1. **Navigate to the API Directory**

    ```bash
    cd MonteCarloSimulatorAPI
    ```

2. **Run the API**

    ```bash
    dotnet run
    ```

    The API will start and listen on the following URLs:

    - `https://localhost:5022/`
    - `http://localhost:5022/`

### Run the Web Application

1. **Navigate to the Web App Directory**

    ```bash
    cd ../MonteCarloSimulatorWebApp
    ```

2. **Open `index.html` in Your Browser**

    - You can open the `index.html` file directly in your web browser by double-clicking it or using the browser's "Open File" option.
    - Alternatively, you can serve it using a local server for better performance and compatibility.

    **Using a Local Server (Optional):**

    If you have Node.js installed, you can use `http-server`:

    ```bash
    npm install -g http-server
    http-server
    ```

    Then, navigate to the URL provided by `http-server` (e.g., `http://127.0.0.1:8080`).

## API Documentation

The API comes with integrated Swagger UI for easy exploration and testing.

1. **Access Swagger UI**

    Open your web browser and navigate to:

    ```
    https://localhost:5022/
    ```

    or

    ```
    http://localhost:5022/
    ```

    The Swagger UI will be displayed, allowing you to interact with the API endpoints directly from the browser.

## Web Application Usage

The Web Application provides a user-friendly interface to input option parameters, interact with the API, and view simulation results.

1. **Open the Web App**

    - Open `index.html` in your web browser.

2. **Input Parameters**

    - **Option Parameters:**
      - Stock Price
      - Strike Price
      - Risk-Free Rate (%)
      - Volatility (%)
      - Time to Maturity (years)

    - **Simulation Settings:**
      - Number of Steps
      - Number of Simulations
      - Option Type (Call or Put)
      - Option Style (European, Asian, Digital, Barrier, Lookback, Range)

    - **Advanced Settings:**
      - Antithetic Variable
      - Control Variate
      - Multithreaded Execution
      - Use Van der Corput Sequence

    - **Additional Inputs:**
      - Depending on the Option Style selected, additional fields like Rebate, Barrier Level, Barrier Type, Base1, and Base2 will appear.

3. **Simulate**

    - Click the **Simulate** button to send the parameters to the API.
    - View the simulation results displayed below the form.

## Usage Example

### Using the Web Application

1. **Fill in the Parameters**

    **Example 1: European Option**

    - **Option Parameters:**
      - Stock Price: 100
      - Strike Price: 100
      - Risk-Free Rate (%): 5
      - Volatility (%): 20
      - Time to Maturity (years): 1

    - **Simulation Settings:**
      - Number of Steps: 100
      - Number of Simulations: 10000
      - Option Type: Call Option
      - Option Style: European Option

    - **Advanced Settings:**
      - Antithetic Variable: No
      - Control Variate: No
      - Multithreaded Execution: No
      - Use Van der Corput Sequence: No

2. **Click Simulate**

    - The results will display the calculated Price and Greeks.

    **Example 2: Barrier Option**

    - **Option Parameters:**
      - Stock Price: 100
      - Strike Price: 100
      - Risk-Free Rate (%): 5
      - Volatility (%): 20
      - Time to Maturity (years): 1

    - **Simulation Settings:**
      - Number of Steps: 100
      - Number of Simulations: 10000
      - Option Type: Call Option
      - Option Style: Barrier Option

    - **Advanced Settings:**
      - Antithetic Variable: No
      - Control Variate: No
      - Multithreaded Execution: No
      - Use Van der Corput Sequence: Yes
      - **Additional Inputs:**
        - Barrier Level: 2
        - Barrier Type: Down-and-In
        - Base 1 (Prime Number): 2
        - Base 2 (Prime Number): 5

3. **View Results**

    - The simulation results will display the Price and Greeks based on the Barrier Option parameters.

### Using Postman

1. **Open Postman.**

2. **Create a New Request.**

    - Click on **New** > **HTTP Request**.

3. **Set the Request Method to POST.**

4. **Enter the Request URL.**

    - Use `https://localhost:5022/api/Simulation/price-option`

5. **Set the Headers.**

    - **Key**: `Content-Type`
    - **Value**: `application/json`

6. **Set the Request Body.**

    - Select **raw** and choose **JSON** from the dropdown.
    - Paste the following JSON example:

    ```json
    {
        "StockPrice": 100.0,
        "StrikePrice": 100.0,
        "RiskFreeRate": 0.05,
        "Volatility": 0.2,
        "TimeToMaturity": 1.0,
        "Steps": 100,
        "Simulations": 10000,
        "IsCall": true,
        "Antithetic": false,
        "ControlVariate": false,
        "Multithreaded": false,
        "OptionType": 1,
        "UseVDCSequence": false,
        "Base1": 2,
        "Base2": 3,
        "Rebate": 0,
        "Barrier": 0.2,
        "BarrierType": 1
    }
    ```

7. **Send the Request.**

8. **Review the Response.**

    - You should receive a JSON response containing the simulation results, for example:

    ```json
    {
        "price": 10.450583572185565,
        "standardError": 0.123456789,
        "delta": 0.5123456789,
        "gamma": 0.0123456789,
        "vega": 0.123456789,
        "theta": -0.123456789,
        "rho": 0.23456789
    }
    ```
