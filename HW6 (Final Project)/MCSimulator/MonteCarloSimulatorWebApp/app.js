document.addEventListener('DOMContentLoaded', function () {
    const optionForm = document.getElementById('optionForm');
    const optionTypeSelect = document.getElementById('optionType');
    const additionalInputsDiv = document.getElementById('additionalInputs');
    const vdcInputsDiv = document.getElementById('vdcInputs');
    const useVDCSequenceSelect = document.getElementById('useVDCSequence');
    const antitheticSelect = document.getElementById('antithetic');
    const controlVariateSelect = document.getElementById('controlVariate');
    const resultsDiv = document.getElementById('results');

    // Function to update additional inputs based on option type
    function updateAdditionalInputs() {
        const optionType = parseInt(optionTypeSelect.value);
        additionalInputsDiv.innerHTML = ''; // Clear previous inputs

        if (optionType === 3) {
            // Digital Option requires Rebate
            const rebateGroup = createFormGroup('Rebate Amount:', 'rebate', 'number', true);
            additionalInputsDiv.appendChild(rebateGroup);
        } else if (optionType === 4) {
            // Barrier Option requires Barrier and Barrier Type
            const barrierGroup = createFormGroup('Barrier Level:', 'barrier', 'number', true);
            additionalInputsDiv.appendChild(barrierGroup);

            const barrierTypeGroup = createFormGroup('Barrier Type:', 'barrierType', 'select', true, [
                { value: '1', text: 'Up-and-In' },
                { value: '2', text: 'Up-and-Out' },
                { value: '3', text: 'Down-and-In' },
                { value: '4', text: 'Down-and-Out' },
            ]);
            additionalInputsDiv.appendChild(barrierTypeGroup);
        }
    }

    // Function to update VDC inputs
    function updateVDCInputs() {
        const useVDCSequence = useVDCSequenceSelect.value === 'true';
        if (useVDCSequence) {
            vdcInputsDiv.innerHTML = '';
            const base1Group = createFormGroup('Base 1 (Prime Number):', 'base1', 'number', true);
            vdcInputsDiv.appendChild(base1Group);

            const base2Group = createFormGroup('Base 2 (Prime Number):', 'base2', 'number', true);
            vdcInputsDiv.appendChild(base2Group);

            // Disable Antithetic and Control Variate
            antitheticSelect.value = 'false';
            controlVariateSelect.value = 'false';
            antitheticSelect.disabled = true;
            controlVariateSelect.disabled = true;
        } else {
            vdcInputsDiv.innerHTML = '';
            antitheticSelect.disabled = false;
            controlVariateSelect.disabled = false;
        }
    }

    // Helper function to create form groups
    function createFormGroup(labelText, inputId, inputType, required = false, options = []) {
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';

        const label = document.createElement('label');
        label.setAttribute('for', inputId);
        label.textContent = labelText;

        let input;
        if (inputType === 'select') {
            input = document.createElement('select');
            input.id = inputId;
            input.name = inputId;
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                input.appendChild(option);
            });
        } else {
            input = document.createElement('input');
            input.type = inputType;
            input.id = inputId;
            input.name = inputId;
            if (inputType === 'number') {
                input.step = 'any';
            }
        }
        if (required) {
            input.required = true;
        }

        formGroup.appendChild(label);
        formGroup.appendChild(input);

        return formGroup;
    }

    // Event listener for option type change
    optionTypeSelect.addEventListener('change', updateAdditionalInputs);

    // Event listener for VDC sequence change
    useVDCSequenceSelect.addEventListener('change', updateVDCInputs);

    // Initial calls to set up the additional inputs
    updateAdditionalInputs();
    updateVDCInputs();

    // Event listener for form submission
    optionForm.addEventListener('submit', function (event) {
        event.preventDefault(); // Prevent the default form submission

        // Collect form data
        const formData = new FormData(optionForm);
        const data = {};

        formData.forEach((value, key) => {
            if (key === 'isCall' || key === 'antithetic' || key === 'controlVariate' || key === 'multithreaded' || key === 'useVDCSequence') {
                data[key] = value === 'true';
            } else if (key === 'optionType' || key === 'barrierType' || key === 'base1' || key === 'base2' || key === 'steps' || key === 'simulations') {
                data[key] = parseInt(value);
            } else {
                data[key] = parseFloat(value);
            }
        });

        // Adjust percentages to decimals
        data.riskFreeRate = data.riskFreeRate / 100;
        data.volatility = data.volatility / 100;

        // Remove optional parameters not needed based on option type
        if (data.optionType !== 3) { // If not Digital Option
            delete data.rebate;
        }

        if (data.optionType !== 4) { // If not Barrier Option
            delete data.barrier;
            delete data.barrierType;
        }

        if (!data.useVDCSequence) { // If not using Van der Corput Sequence
            delete data.base1;
            delete data.base2;
        }

        // Make API call
        fetch('http://localhost:5022/api/Simulation/price-option', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error ${response.status}: ${errorText}`);
            }
            return response.json();
        })
        .then(result => {
            displayResults(result);
        })
        .catch(error => {
            console.error('Error:', error);
            resultsDiv.innerHTML = `<p class="error-message">${error.message}</p>`;
        });
    });

    // Function to display results
    function displayResults(result) {
        resultsDiv.innerHTML = ''; // Clear previous results

        const resultsHeader = document.createElement('h2');
        resultsHeader.textContent = 'Simulation Results';
        resultsDiv.appendChild(resultsHeader);

        const resultsList = document.createElement('div');
        resultsList.className = 'results-list';

        for (const [key, value] of Object.entries(result)) {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';

            const labelSpan = document.createElement('span');
            labelSpan.className = 'result-label';
            labelSpan.textContent = formatLabel(key);

            const valueSpan = document.createElement('span');
            valueSpan.className = 'result-value';
            valueSpan.textContent = value.toFixed(6);

            resultItem.appendChild(labelSpan);
            resultItem.appendChild(valueSpan);

            resultsList.appendChild(resultItem);
        }

        resultsDiv.appendChild(resultsList);
    }

    // Helper function to format labels
    function formatLabel(label) {
        switch (label) {
            case 'price':
                return 'Price:';
            case 'standardError':
                return 'Standard Error:';
            case 'delta':
                return 'Delta:';
            case 'gamma':
                return 'Gamma:';
            case 'vega':
                return 'Vega:';
            case 'theta':
                return 'Theta:';
            case 'rho':
                return 'Rho:';
            default:
                return label + ':';
        }
    }
});
