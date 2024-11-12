# Monte Carlo Simulator API

An ASP.NET Core Web API for pricing various types of options using Monte Carlo simulation. This API allows users to interact with the simulator via HTTP requests, enabling remote access and integration with tools like Postman.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the API](#running-the-api)
- [API Documentation](#api-documentation)
- [Usage Example](#usage-example)
  - [Using Postman](#using-postman)
- [License](#license)

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- [.NET 6.0 SDK or later](https://dotnet.microsoft.com/download)
- [Visual Studio Code](https://code.visualstudio.com/) with the C# extension
- [Postman](https://www.postman.com/downloads/) (optional, for testing)

## Setup

1. **Clone the Repository**

   ```bash
   git clone https://github.com/yourusername/MonteCarloSimulatorAPI.git
   cd MonteCarloSimulatorAPI
   ```

2. **Restore Dependencies**

   Open the terminal in the project directory and run:

   ```bash
   dotnet restore
   ```

3. **Build the Project**

   ```bash
   dotnet build
   ```

## Running the API

Start the API by running the following command in the project directory:

```bash
dotnet run
```

The API will start and listen on the following URLs:

- `https://localhost:5001/`
- `http://localhost:5000/`

## API Documentation

The API comes with integrated Swagger UI for easy exploration and testing.

1. **Access Swagger UI**

   Open your web browser and navigate to:

   ```
   https://localhost:5001/
   ```

   or

   ```
   http://localhost:5000/
   ```

   The Swagger UI will be displayed, allowing you to interact with the API endpoints directly from the browser.

## Usage Example

### Using Postman

Follow these steps to interact with the API using Postman:

1. **Open Postman.**

2. **Create a New Request.**
   
   - Click on **New** > **HTTP Request**.

3. **Set the Request Method to POST.**
   
   - In the dropdown next to the URL field, select **POST**.

4. **Enter the Request URL.**
   
   - Use `https://localhost:5001/api/simulation/price-option` (adjust the port if necessary).

5. **Set the Headers.**
   
   - Click on the **Headers** tab.
   - Add a new header:
     - **Key**: `Content-Type`
     - **Value**: `application/json`

6. **Set the Request Body.**
   
   - Click on the **Body** tab.
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
   
   - Click on the **Send** button.

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

Example of API Interface:

![WhatsApp Image 2024-11-12 at 00 25 02_6ea6f5ec](https://github.com/user-attachments/assets/909b4392-7d1c-49c9-a86f-9b2f3d80611c)

