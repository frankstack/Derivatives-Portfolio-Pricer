# FM5353 Monte Carlo Simulator for European Options

## Description

This Monte Carlo simulator is designed to estimate the price of European options (both call and put) and calculate the option Greeks: Delta, Gamma, Vega, Theta, and Rho. The simulator supports **Antithetic Variates**, **Control Variates**, and **Van der Corput low-discrepancy sequences** to enhance the accuracy and efficiency of the results. The control variate technique significantly reduces the variance of the simulation, providing more reliable estimates.

## Components

### Classes and Functions

- **SimulationOutput**:
    - Responsible for displaying the simulation results in a formatted manner, including the price, standard error, and the Greeks.

- **MathExtensions**:
    - Provides a method for calculating the standard normal cumulative distribution function (CDF) using the Abramowitz & Stegun approximation.

- **RandomNumberGenerator**:
    - Generates standard normal random numbers using the Box-Muller transformation. It supports **Antithetic Variates** to improve the efficiency of the simulation.

- **VanDerCorputGenerator**:
    - Generates random numbers using the Van der Corput low-discrepancy sequence, enhancing the simulation's accuracy for scenarios that require better distribution of random numbers.

- **SimulationManager**:
    - Runs the core Monte Carlo simulation, evolving stock prices using the Euler-Maruyama method. This class handles the execution of both **Antithetic Variates** and **Control Variates**:
        - **Antithetic Variates** improve the precision by using negatively correlated paths.
        - **Control Variates** reduce the variance of the estimated payoffs by incorporating known analytical values, thereby improving the accuracy of the simulation results.

- **GreeksCalculator**:
    - Calculates option Greeks, including Delta, Gamma, Vega, Theta, and Rho, using numerical methods such as finite differences. The calculations can include **Control Variates** for more accurate results by adjusting the payoff computations.

- **Option** and **European**:
    - Abstract base class (`Option`) and its derived class (`European`) for representing European options. The European class contains the logic to calculate the option's payoff and delta using the Black-Scholes formula.

- **MonteCarloSimulator**:
    - The main class that gathers input parameters from the user, configures the simulation with options such as **Antithetic Variates**, **Control Variates**, and **Van der Corput Sequences**, and manages the execution of the Monte Carlo process.

## Usage

### Input Parameters

The user provides the following inputs:
- **Stock price**: The current price of the underlying asset.
- **Strike price**: The strike price of the option.
- **Risk-free rate**: The risk-free interest rate (annualized).
- **Volatility**: The annualized volatility of the underlying asset.
- **Time to maturity**: The time remaining until the option expires (in years).
- **Number of steps**: The number of discrete time intervals in the simulation.
- **Number of simulations**: The number of Monte Carlo simulation paths.

Additionally, the user can choose whether to enable:
- **Antithetic Variates**: Improves the accuracy by simulating negatively correlated asset paths.
- **Control Variates**: Reduces variance by adjusting the payoffs using known analytical values.
- **Van der Corput Sequence**: Generates random numbers using a low-discrepancy sequence to enhance convergence.

### Execution

1. The user inputs the required parameters (e.g., stock price, strike price, etc.).
2. The program runs the Monte Carlo simulation to estimate the option price and Greeks.
3. The results are displayed, including the option price, standard error, and Greeks (Delta, Gamma, Vega, Theta, Rho).

### Example Run

```plaintext
***>>> ------ FM5353 | Monte Carlo Simulator ------ <<<***
            >> European Options Type Class <<
    Enter 'exit' at any time to close the program.
**---------------------------------------------------------**
> Note: If Van der Corput sequence is activated, Antithetic and Control Variate cannot be activated.

>>> User Parameters Input:::

Enter stock price: 100
Enter strike price: 100
Enter risk-free rate: 0.05
Enter volatility: 0.2
Enter time to maturity (in years): 1
Activate Van der Corput Sequence (1: yes, 0: no): 0
Activate Antithetic Variable (1: yes, 0: no): 1
Activate Control Variate (1: yes, 0: no): 1
Enter number of steps: 50
Enter number of simulations: 10000

::: >>> FM5353 - Monte Carlo Simulator ||| General Results:
        ******************************************
Call Option Results:
- Price: ...
- Standard Error: ...
- Delta: ...
- Gamma: ...
- Vega: ...
- Theta: ...
- Rho: ...

Put Option Results:
- Price: ...
- Standard Error: ...
- Delta: ...
- Gamma: ...
- Vega: ...
- Theta: ...
- Rho: ...

>>> Program Finished
```

## Prerequisites

- .NET SDK
- Familiarity with C# and object-oriented programming
- Basic knowledge of options pricing and Greeks (Delta, Gamma, etc.)
