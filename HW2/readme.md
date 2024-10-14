# Monte Carlo Simulator (Multithreading Capability Update)

## Overview

This project updates our previous Monte Carlo Simulator for pricing European options and calculating their Greeks. The new feature of this simulator is its **multithreading capability**, which significantly accelerates the computation process by utilizing multiple CPU cores.

## Key Features

- **Multithreaded Execution:** The simulator leverages multithreading to parallelize simulations, making use of all available CPU cores. This improves performance, especially when the users wants to run a large number of simulations.
- **Monte Carlo Simulation:** Simulates option prices using either standard random numbers or low-discrepancy sequences (Van der Corput).
- **Control Variates & Antithetic Variables:** Optional techniques to improve the accuracy of simulations.

## Usage

During the simulation setup, the user can enable multithreading by specifying the number of threads to be used. If activated, the simulator will split the workload across the available cores.

```csharp
double multithreadingOption = GetBinaryInput("Enable multithreaded execution (1: yes, 0: no): ");
bool multithreaded = multithreadingOption == 1;
```

When multithreading is enabled, the simulator utilizes the `.Parallel.For()` method to parallelize the simulation of option prices across multiple threads.

