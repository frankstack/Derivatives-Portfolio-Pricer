# Monte Carlo Option Pricing Simulator

This folder in the `YGNACIO-FM5353` repository contains a C# implementation of a Monte Carlo simulator for pricing a variety of option types, including both vanilla and exotic options. The simulator calculates option prices and Greeks, supporting features like antithetic variates, control variates, and multithreading for enhanced performance and accuracy.

## Supported Option Types

- **European Option**
- **Asian Option (Geometric Average)**
- **Digital Option**
- **Barrier Option**
  - Up-and-In
  - Up-and-Out
  - Down-and-In
  - Down-and-Out
- **Lookback Option**
- **Range Option**

## Features

- **Option Pricing and Greeks Calculation**: Computes option price along with Delta, Gamma, Vega, Theta, and Rho.
- **Antithetic Variates**: Reduces variance in simulation results.
- **Control Variates**: Improves estimation accuracy.
- **Multithreading**: Utilizes multiple CPU cores for faster computation.
- **Random Number Generators**:
  - Standard random numbers via Box-Muller transformation.
  - Low-discrepancy sequences using the Van der Corput method.

## Usage

Run the console application and follow the prompts to input parameters. 

Example:

```
Enter stock price: 100
Enter strike price: 100
Enter risk-free rate: 0.05
Enter volatility: 0.2
Enter time to maturity (in years): 1
Activate Van der Corput Sequence (1: yes, 0: no): 0
Activate Antithetic Variable (1: yes, 0: no): 1
Activate Control Variate (1: yes, 0: no): 1
Enter number of steps: 1000
Enter number of simulations: 10000
>> COMPUTATION: Enable multithreaded execution (1: yes, 0: no): 1

Select Option Type:
1) European Option
2) Asian Option (Geometric)
3) Digital Option
4) Barrier Option
5) Lookback Option
6) Range Option
Enter option type (1-6): 3
Is it a Call option? (1: yes, 0: no): 1
Enter rebate amount: 1
```

**Note**:

- **Digital Option** requires the **rebate amount**, which is the fixed payout if the option expires in-the-money.
- **Barrier Option** requires the **barrier level** and selection of the **barrier type**.

## Output

After processing, the simulator displays the option price and Greeks:

```
::: >>> FM5353 - Monte Carlo Simulator ||| General Results:
        **************************************************
Option Option Results:
- Price: [calculated price],
- Standard Error: [calculated standard error],
- Delta: [calculated delta],
- Gamma: [calculated gamma],
- Vega: [calculated vega],
- Theta: [calculated theta],
- Rho: [calculated rho]
-----------------------------------------------------------------

 >>> Program Finished
```

## Compilation and Execution

1. Clone or download the repository.
2. Open the solution in Visual Studio or another C# IDE.
3. Build the solution to restore dependencies.
4. Run the application.
