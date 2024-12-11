/* portfolioManager.js */

document.addEventListener('DOMContentLoaded', () => {
    const BASE_URL = 'http://localhost:5022/api';

    // Chart instances
    let underlyingChartInstance = null;
    let rateCurveChartInstance = null;

    const navButtons = document.querySelectorAll('.pm-nav-button');
    const sections = document.querySelectorAll('.pm-section');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const sectionId = btn.getAttribute('data-section');
            sections.forEach(sec => sec.classList.add('hidden'));
            document.getElementById(sectionId).classList.remove('hidden');
        });
    });

    function formatDateForInput(isoString) {
        if(!isoString) return '';
        const date = new Date(isoString);
        const pad = n => n<10?'0'+n:n;
        return date.getFullYear() + '-' + pad(date.getMonth()+1) + '-' + pad(date.getDate())
            + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    // SECTION 1: Underlyings Section
    const underlyingsForm = document.getElementById('underlyingsForm');
    const underlyingSymbol = document.getElementById('underlyingSymbol');
    const underlyingName = document.getElementById('underlyingName');
    const underlyingHistPrices = document.getElementById('underlyingHistPrices');
    const underlyingId = document.getElementById('underlyingId');
    const underlyingsTable = document.getElementById('underlyingsTable').querySelector('tbody');
    const cancelUnderlyingEditButton = document.getElementById('cancelUnderlyingEditButton');

    const underlyingDetailsTable = document.getElementById('underlyingDetailsTable');
    const underlyingDetailsTableBody = underlyingDetailsTable.querySelector('tbody');
    const underlyingChartCanvas = document.getElementById('underlyingChart');

    function loadUnderlyings() {
        fetch(`${BASE_URL}/Underlyings`)
            .then(res => res.json())
            .then(data => {
                underlyingsTable.innerHTML = '';
                data.forEach(u => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${u.id}</td>
                        <td>${u.symbol}</td>
                        <td>${u.name || ''}</td>
                        <td>${u.historicalPrices ? u.historicalPrices.length : 0}</td>
                        <td>
                            <button data-id="${u.id}" class="edit-underlying-btn">Edit</button>
                            <button data-id="${u.id}" class="details-underlying-btn">See Details</button>
                            <button data-id="${u.id}" class="delete-underlying-btn">Delete</button>
                        </td>
                    `;
                    underlyingsTable.appendChild(tr);
                });
                attachUnderlyingActions();
            })
            .catch(err => console.error(err));
    }

    function attachUnderlyingActions() {
        document.querySelectorAll('.edit-underlying-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/Underlyings/${id}`)
                    .then(res => res.json())
                    .then(u => {
                        underlyingSymbol.value = u.symbol;
                        underlyingName.value = u.name || '';
                        underlyingHistPrices.value = JSON.stringify(u.historicalPrices || [], null, 2);
                        underlyingId.value = u.id;
                        cancelUnderlyingEditButton.classList.remove('hidden');
                    })
                    .catch(err => console.error(err));
            });
        });

        document.querySelectorAll('.delete-underlying-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Are you sure you want to delete this underlying?')) {
                    fetch(`${BASE_URL}/Underlyings/${id}`, { method: 'DELETE' })
                        .then(() => {
                            loadUnderlyings();
                            // Clear details section if the deleted underlying was being viewed
                            clearUnderlyingDetails();
                        })
                        .catch(err => console.error(err));
                }
            });
        });

        document.querySelectorAll('.details-underlying-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/Underlyings/${id}`)
                    .then(res => res.json())
                    .then(u => {
                        const prices = u.historicalPrices || [];
                        underlyingDetailsTableBody.innerHTML = '';
                        if (prices.length > 0) {
                            prices.forEach(p => {
                                const row = document.createElement('tr');
                                row.innerHTML = `
                                    <td>${u.symbol}</td>
                                    <td>${p.date}</td>
                                    <td>${p.price}</td>
                                `;
                                underlyingDetailsTableBody.appendChild(row);
                            });
                            underlyingDetailsTable.classList.remove('hidden');
                            // IMPORTANT: Create chart...
                            createUnderlyingChart(u.symbol, prices);
                        } else {
                            underlyingDetailsTableBody.innerHTML = '<tr><td colspan="3">No historical prices found.</td></tr>';
                            underlyingDetailsTable.classList.remove('hidden');
                            // In case there are no data for chart
                            if (underlyingChartInstance) {
                                underlyingChartInstance.destroy();
                                underlyingChartInstance = null;
                            }
                            underlyingChartCanvas.classList.add('hidden');
                        }
                    })
                    .catch(err => console.error(err));
            });
        });
    }

    underlyingsForm.addEventListener('submit', e => {
        e.preventDefault();
        const symbol = underlyingSymbol.value.trim();
        const name = underlyingName.value.trim();
        let histPrices = [];
        try {
            if (underlyingHistPrices.value.trim()) {
                histPrices = JSON.parse(underlyingHistPrices.value);
            }
        } catch (error) {
            alert('Historical Prices must be valid JSON.');
            return;
        }

        const body = {
            symbol: symbol,
            name: name || null,
            historicalPrices: histPrices
        };

        const idVal = underlyingId.value;
        if (idVal) {
            // Update existing underlying
            body.id = parseInt(idVal);
            fetch(`${BASE_URL}/Underlyings/${idVal}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(res => {
                    if (!res.ok) throw new Error('Error updating underlying.');
                    return res.text();
                })
                .then(() => {
                    resetUnderlyingForm();
                    loadUnderlyings();
                    clearUnderlyingDetails();
                })
                .catch(err => console.error(err));
        } else {
            // Create new underlying
            fetch(`${BASE_URL}/Underlyings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(res => {
                    if (!res.ok) throw new Error('Error creating underlying.');
                    return res.json();
                })
                .then(() => {
                    resetUnderlyingForm();
                    loadUnderlyings();
                })
                .catch(err => console.error(err));
        }
    });

    cancelUnderlyingEditButton.addEventListener('click', () => {
        resetUnderlyingForm();
    });

    function resetUnderlyingForm() {
        underlyingSymbol.value = '';
        underlyingName.value = '';
        underlyingHistPrices.value = '';
        underlyingId.value = '';
        cancelUnderlyingEditButton.classList.add('hidden');
    }

    function clearUnderlyingDetails() {
        underlyingDetailsTableBody.innerHTML = '';
        underlyingDetailsTable.classList.add('hidden');
        if (underlyingChartInstance) {
            underlyingChartInstance.destroy();
            underlyingChartInstance = null;
        }
        underlyingChartCanvas.classList.add('hidden');
    }

    function createUnderlyingChart(symbol, prices) {
        // If chart exists, destroy first
        if (underlyingChartInstance) {
            underlyingChartInstance.destroy();
        }

        const ctx = underlyingChartCanvas.getContext('2d');
        underlyingChartCanvas.classList.remove('hidden');
        // Extract arrays of values: labels and datapoints to plotting
        const labels = prices.map(p => p.date);
        const dataPoints = prices.map(p => p.price);
        // PLOT MAIN READING PROCEDURE! Here Chart.js reads the labels and datasets and drawss a line chart.
        // Also, the style is defined properly
        underlyingChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Price',
                    data: dataPoints,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52,152,219,0.2)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 3
                }]
            },
            options: {
                scales: {
                    x: {
                        type: 'category',
                        title: { display: true, text: 'Date', color: '#333' },
                        ticks: { color: '#333', maxRotation: 45, minRotation: 45 },
                        grid: { color: '#ccc' }
                    },
                    y: {
                        title: { display: true, text: 'Price', color: '#333' },
                        ticks: { color: '#333' },
                        grid: { color: '#ccc' }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Time Series: ' + symbol, // symbol as object name
                        color: '#2c3e50',
                        font: { size: 16 }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                maintainAspectRatio: false
            }
        });
    }

    // SECTION 2: Derivatives Section
    const derivativesForm = document.getElementById('derivativesForm');
    const derivativeSymbol = document.getElementById('derivativeSymbol');
    const derivativeName = document.getElementById('derivativeName');
    const derivativeStrikePrice = document.getElementById('derivativeStrikePrice');
    const derivativeExpirationDate = document.getElementById('derivativeExpirationDate');
    const derivativeOptionStyle = document.getElementById('derivativeOptionStyle');
    const derivativeIsCall = document.getElementById('derivativeIsCall');
    const derivativeUnderlyingId = document.getElementById('derivativeUnderlyingId');
    const derivativeOptionType = document.getElementById('derivativeOptionType');
    const derivativeId = document.getElementById('derivativeId');
    const derivativeExtraFields = document.getElementById('derivativeExtraFields');
    const cancelDerivativeEditButton = document.getElementById('cancelDerivativeEditButton');

    const derivativesTable = document.getElementById('derivativesTable').querySelector('tbody');

    function loadDerivatives() {
        fetch(`${BASE_URL}/OptionEntities`)
            .then(res => res.json())
            .then(data => {
                derivativesTable.innerHTML = '';
                data.forEach(d => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${d.id}</td>
                        <td>${d.symbol}</td>
                        <td>${d.name || ''}</td>
                        <td>${d.strikePrice}</td>
                        <td>${new Date(d.expirationDate).toLocaleString()}</td>
                        <td>${d.optionStyle}</td>
                        <td>${d.isCall}</td>
                        <td>${d.underlying ? d.underlying.symbol : ''}</td>
                        <td>
                            <button data-id="${d.id}" class="edit-derivative-btn">Edit</button>
                            <button data-id="${d.id}" class="delete-derivative-btn">Delete</button>
                        </td>
                    `;
                    derivativesTable.appendChild(tr);
                });
                attachDerivativeActions();
            })
            .catch(err => console.error(err));
    }

    function attachDerivativeActions() {
        document.querySelectorAll('.edit-derivative-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/OptionEntities/${id}`)
                    .then(res => res.json())
                    .then(d => {
                        derivativeSymbol.value = d.symbol;
                        derivativeName.value = d.name || '';
                        derivativeStrikePrice.value = d.strikePrice;
                        derivativeExpirationDate.value = formatDateForInput(d.expirationDate);
                        derivativeOptionStyle.value = d.optionStyle;
                        derivativeIsCall.value = d.isCall ? 'true' : 'false';
                        derivativeUnderlyingId.value = d.underlyingId;
                        derivativeOptionType.value = d.optionType;
                        derivativeId.value = d.id;
                        handleDerivativeOptionTypeChange(d.optionType, d);
                        cancelDerivativeEditButton.classList.remove('hidden');
                    })
                    .catch(err => console.error(err));
            });
        });

        document.querySelectorAll('.delete-derivative-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Delete this derivative?')) {
                    fetch(`${BASE_URL}/OptionEntities/${id}`, { method: 'DELETE' })
                        .then(() => {
                            loadDerivatives();
                        })
                        .catch(err => console.error(err));
                }
            });
        });
    }

    function handleDerivativeOptionTypeChange(typeVal, derivativeData = null) {
        derivativeExtraFields.innerHTML = '';
        if (typeVal === 3) { // Digital
            derivativeExtraFields.innerHTML = `
                <div class="pm-form-group">
                    <label for="derivativeRebate">Rebate:</label>
                    <input type="number" step="any" id="derivativeRebate" value="${derivativeData ? derivativeData.rebate : ''}">
                </div>
            `;
        } else if (typeVal === 4) { // Barrier
            derivativeExtraFields.innerHTML = `
                <div class="pm-form-group">
                    <label for="derivativeBarrier">Barrier:</label>
                    <input type="number" step="any" id="derivativeBarrier" required value="${derivativeData ? derivativeData.barrier : ''}">
                </div>
                <div class="pm-form-group">
                    <label for="derivativeBarrierType">Barrier Type:</label>
                    <select id="derivativeBarrierType">
                        <option value="1" ${derivativeData && derivativeData.barrierType === 1 ? 'selected' : ''}>Up-and-In</option>
                        <option value="2" ${derivativeData && derivativeData.barrierType === 2 ? 'selected' : ''}>Up-and-Out</option>
                        <option value="3" ${derivativeData && derivativeData.barrierType === 3 ? 'selected' : ''}>Down-and-In</option>
                        <option value="4" ${derivativeData && derivativeData.barrierType === 4 ? 'selected' : ''}>Down-and-Out</option>
                    </select>
                </div>
            `;
        }
    }

    derivativeOptionType.addEventListener('change', () => {
        const typeVal = parseInt(derivativeOptionType.value);
        handleDerivativeOptionTypeChange(typeVal);
    });

    derivativesForm.addEventListener('submit', e => {
        e.preventDefault();
        const body = {
            id: derivativeId.value ? parseInt(derivativeId.value) : 0,
            symbol: derivativeSymbol.value.trim(),
            name: derivativeName.value.trim() || null,
            strikePrice: parseFloat(derivativeStrikePrice.value),
            expirationDate: new Date(derivativeExpirationDate.value).toISOString(),
            optionStyle: parseInt(derivativeOptionStyle.value),
            isCall: (derivativeIsCall.value === 'true'),
            underlyingId: parseInt(derivativeUnderlyingId.value),
            optionType: parseInt(derivativeOptionType.value)
        };

        const typeVal = body.optionType;
        if (typeVal === 3) { // Digital
            const rebateEl = document.getElementById('derivativeRebate');
            body.rebate = parseFloat(rebateEl.value);
        } else if (typeVal === 4) { // Barrier
            const barrierEl = document.getElementById('derivativeBarrier');
            const barrierTypeEl = document.getElementById('derivativeBarrierType');
            body.barrier = parseFloat(barrierEl.value);
            body.barrierType = parseInt(barrierTypeEl.value);
        }

        const method = body.id ? 'PUT' : 'POST';
        const url = body.id ? `${BASE_URL}/OptionEntities/${body.id}` : `${BASE_URL}/OptionEntities`;

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(res => {
                if (!res.ok) throw new Error('Error saving derivative.');
                return res.json().catch(() => null);
            })
            .then(() => {
                resetDerivativesForm();
                loadDerivatives();
            })
            .catch(err => console.error(err));
    });

    cancelDerivativeEditButton.addEventListener('click', () => {
        resetDerivativesForm();
    });

    function resetDerivativesForm() {
        derivativeSymbol.value = '';
        derivativeName.value = '';
        derivativeStrikePrice.value = '';
        derivativeExpirationDate.value = '';
        derivativeOptionStyle.value = '1';
        derivativeIsCall.value = 'true';
        derivativeUnderlyingId.value = '';
        derivativeOptionType.value = '1';
        derivativeId.value = '';
        derivativeExtraFields.innerHTML = '';
        cancelDerivativeEditButton.classList.add('hidden');
    }

    // SECTION 3: Trades Section
    const tradesForm = document.getElementById('tradesForm');
    const tradeInstrumentId = document.getElementById('tradeInstrumentId');
    const tradeQuantity = document.getElementById('tradeQuantity');
    const tradeDate = document.getElementById('tradeDate');
    const tradePrice = document.getElementById('tradePrice');
    const tradeId = document.getElementById('tradeId');
    const tradesTable = document.getElementById('tradesTable').querySelector('tbody');
    const cancelTradeEditButton = document.getElementById('cancelTradeEditButton');

    function loadTrades() {
        fetch(`${BASE_URL}/Trades`)
            .then(res => res.json())
            .then(data => {
                tradesTable.innerHTML = '';
                data.forEach(t => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${t.id}</td>
                        <td>${t.instrumentId}</td>
                        <td>${t.instrument ? t.instrument.symbol : ''}</td>
                        <td>${t.instrument ? (t.instrument.name || '') : ''}</td>
                        <td>${t.quantity}</td>
                        <td>${new Date(t.tradeDate).toLocaleString()}</td>
                        <td>${t.price}</td>
                        <td>
                            <button data-id="${t.id}" class="edit-trade-btn">Edit</button>
                            <button data-id="${t.id}" class="delete-trade-btn">Delete</button>
                        </td>
                    `;
                    tradesTable.appendChild(tr);
                });
                attachTradeActions();
                loadValuationTrades(); 
            })
            .catch(err => console.error(err));
    }

    function attachTradeActions() {
        document.querySelectorAll('.edit-trade-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/Trades/${id}`)
                    .then(res => res.json())
                    .then(t => {
                        tradeInstrumentId.value = t.instrumentId;
                        tradeQuantity.value = t.quantity;
                        tradeDate.value = formatDateForInput(t.tradeDate);
                        tradePrice.value = t.price;
                        tradeId.value = t.id;
                        cancelTradeEditButton.classList.remove('hidden');
                    })
                    .catch(err => console.error(err));
            });
        });

        document.querySelectorAll('.delete-trade-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Delete this trade?')) {
                    fetch(`${BASE_URL}/Trades/${id}`, { method: 'DELETE' })
                        .then(() => {
                            loadTrades();
                            loadValuationTrades();
                        })
                        .catch(err => console.error(err));
                }
            });
        });
    }

    tradesForm.addEventListener('submit', e => {
        e.preventDefault();
        const body = {
            instrumentId: parseInt(tradeInstrumentId.value),
            quantity: parseInt(tradeQuantity.value),
            tradeDate: new Date(tradeDate.value).toISOString(),
            price: parseFloat(tradePrice.value)
        };
        const idVal = tradeId.value;
        let method, url;
        if (idVal) {
            method = 'PUT';
            url = `${BASE_URL}/Trades/${idVal}`;
            body.id = parseInt(idVal);
        } else {
            method = 'POST';
            url = `${BASE_URL}/Trades`;
        }

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(res => {
                if (!res.ok) throw new Error('Error saving trade.');
                return res.json().catch(() => null);
            })
            .then(() => {
                resetTradesForm();
                loadTrades();
            })
            .catch(err => console.error(err));
    });

    cancelTradeEditButton.addEventListener('click', () => {
        resetTradesForm();
    });

    function resetTradesForm() {
        tradeInstrumentId.value = '';
        tradeQuantity.value = '';
        tradeDate.value = '';
        tradePrice.value = '';
        tradeId.value = '';
        cancelTradeEditButton.classList.add('hidden');
    }

    // SECTION 4: Rates Section
    const ratesForm = document.getElementById('ratesForm');
    const rateCurveName = document.getElementById('rateCurveName');
    const rateCurvesTable = document.getElementById('rateCurvesTable').querySelector('tbody');

    const ratePointsForm = document.getElementById('ratePointsForm');
    const ratePointsCurveId = document.getElementById('ratePointsCurveId');
    const ratePointsJson = document.getElementById('ratePointsJson');

    const getAllRateCurvesButton = document.getElementById('getAllRateCurvesButton');
    const getRateCurveByIdInput = document.getElementById('getRateCurveByIdInput');
    const getRateCurveByIdButton = document.getElementById('getRateCurveByIdButton');

    const editRateCurveForm = document.getElementById('editRateCurveForm');
    const editRateCurveId = document.getElementById('editRateCurveId');
    const editRateCurveName = document.getElementById('editRateCurveName');
    const cancelEditRateCurveButton = document.getElementById('cancelEditRateCurveButton');

    const rateCurveDetailsTable = document.getElementById('rateCurveDetailsTable');
    const rateCurveDetailsTableBody = rateCurveDetailsTable.querySelector('tbody');
    const rateCurveChartCanvas = document.getElementById('rateCurveChart');

    ratesForm.addEventListener('submit', e => {
        e.preventDefault();
        const body = {
            name: rateCurveName.value.trim()
        };
        fetch(`${BASE_URL}/RateCurves`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(res => {
                if(!res.ok) throw new Error('Error creating RateCurve.');
                return res.json();
            })
            .then(curve => {
                alert('RateCurve created with ID: ' + curve.id);
                rateCurveName.value = '';
                loadAllRateCurves();
                loadAllRateCurvesForValuation();
            })
            .catch(err => console.error(err));
    });

    getAllRateCurvesButton.addEventListener('click', () => {
        loadAllRateCurves();
    });

    getRateCurveByIdButton.addEventListener('click', () => {
        const cid = parseInt(getRateCurveByIdInput.value);
        if (isNaN(cid)) {
            alert('Please enter a valid RateCurve ID.');
            return;
        }
        loadRateCurveById(cid);
    });

    function loadAllRateCurves() {
        fetch(`${BASE_URL}/RateCurves`)
            .then(res => {
                if(!res.ok) throw new Error('Error fetching all RateCurves.');
                return res.json();
            })
            .then(data => {
                rateCurvesTable.innerHTML = '';
                if (data.length === 0) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td colspan="4">No RateCurves found.</td>`;
                    rateCurvesTable.appendChild(tr);
                } else {
                    data.forEach(rc => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${rc.id}</td>
                            <td>${rc.name || ''}</td>
                            <td>${rc.ratePoints ? rc.ratePoints.length : 0}</td>
                            <td>
                                <button data-id="${rc.id}" class="edit-ratecurve-btn">Edit</button>
                                <button data-id="${rc.id}" class="details-ratecurve-btn">See Details</button>
                                <button data-id="${rc.id}" class="delete-ratecurve-btn">Delete</button>
                            </td>
                        `;
                        rateCurvesTable.appendChild(tr);
                    });
                    attachRateCurveActions();
                }
            })
            .catch(err => console.error(err));
    }

    function loadRateCurveById(id) {
        fetch(`${BASE_URL}/RateCurves/${id}`)
            .then(async res => {
                if (!res.ok) {
                    if (res.status === 404) {
                        throw new Error('No RateCurve found with the given ID.');
                    } else {
                        const text = await res.text();
                        throw new Error(text);
                    }
                }
                return res.json();
            })
            .then(rc => {
                rateCurvesTable.innerHTML = '';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${rc.id}</td>
                    <td>${rc.name || ''}</td>
                    <td>${rc.ratePoints ? rc.ratePoints.length : 0}</td>
                    <td>
                        <button data-id="${rc.id}" class="edit-ratecurve-btn">Edit</button>
                        <button data-id="${rc.id}" class="details-ratecurve-btn">See Details</button>
                        <button data-id="${rc.id}" class="delete-ratecurve-btn">Delete</button>
                    </td>
                `;
                rateCurvesTable.appendChild(tr);
                attachRateCurveActions();
            })
            .catch(err => {
                alert(err.message);
            });
    }

    function attachRateCurveActions() {
        document.querySelectorAll('.delete-ratecurve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Delete this RateCurve?')) {
                    fetch(`${BASE_URL}/RateCurves/${id}`, { method: 'DELETE' })
                        .then(() => {
                            btn.closest('tr').remove();
                            loadAllRateCurvesForValuation();
                            // Clear details section if the deleted rate curve was being viewed
                            clearRateCurveDetails();
                        })
                        .catch(err => console.error(err));
                }
            });
        });

        document.querySelectorAll('.edit-ratecurve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/RateCurves/${id}`)
                    .then(res => res.json())
                    .then(rc => {
                        editRateCurveId.value = rc.id;
                        editRateCurveName.value = rc.name || '';
                        editRateCurveForm.classList.remove('hidden');
                    })
                    .catch(err => console.error(err));
            });
        });

        document.querySelectorAll('.details-ratecurve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/RateCurves/${id}`)
                    .then(res => res.json())
                    .then(rc => {
                        const points = rc.ratePoints || [];
                        rateCurveDetailsTableBody.innerHTML = '';
                        if (points.length > 0) {
                            points.forEach(p => {
                                const row = document.createElement('tr');
                                row.innerHTML = `
                                    <td>${rc.name || ''}</td>
                                    <td>${p.tenor}</td>
                                    <td>${p.rate}</td>
                                `;
                                rateCurveDetailsTableBody.appendChild(row);
                            });
                            rateCurveDetailsTable.classList.remove('hidden');
                            // Create chart
                            createRateCurveChart(rc.name || `Curve ${rc.id}`, points);
                        } else {
                            rateCurveDetailsTableBody.innerHTML = '<tr><td colspan="3">No rate points found.</td></tr>';
                            rateCurveDetailsTable.classList.remove('hidden');
                            // No data for chart
                            if (rateCurveChartInstance) {
                                rateCurveChartInstance.destroy();
                                rateCurveChartInstance = null;
                            }
                            rateCurveChartCanvas.classList.add('hidden');
                        }
                    })
                    .catch(err => console.error(err));
            });
        });
    }

    editRateCurveForm.addEventListener('submit', e => {
        e.preventDefault();
        const id = parseInt(editRateCurveId.value);
        const name = editRateCurveName.value.trim();
        const body = { id: id, name: name };

        fetch(`${BASE_URL}/RateCurves/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(res => {
                if(!res.ok) throw new Error('Error updating RateCurve.');
                return res.text();
            })
            .then(() => {
                alert('RateCurve updated successfully.');
                cancelEditRateCurve();
                loadAllRateCurves();
                loadAllRateCurvesForValuation();
            })
            .catch(err => console.error(err));
    });

    cancelEditRateCurveButton.addEventListener('click', () => {
        cancelEditRateCurve();
    });

    function cancelEditRateCurve() {
        editRateCurveId.value = '';
        editRateCurveName.value = '';
        editRateCurveForm.classList.add('hidden');
    }

    ratePointsForm.addEventListener('submit', e => {
        e.preventDefault();
        const cid = parseInt(ratePointsCurveId.value);
        let rpArray = [];
        try {
            if (ratePointsJson.value.trim()) {
                rpArray = JSON.parse(ratePointsJson.value);
            } else {
                rpArray = [];
            }
        } catch (error) {
            alert('Invalid JSON for Rate Points.');
            return;
        }

        fetch(`${BASE_URL}/RateCurves/${cid}/RatePoints`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rpArray)
        })
            .then(res => {
                if(!res.ok) throw new Error('Error adding Rate Points.');
                return res.json();
            })
            .then(points => {
                alert('Rate Points added successfully.');
                ratePointsCurveId.value = '';
                ratePointsJson.value = '';
                loadRateCurveById(cid);
                loadAllRateCurvesForValuation();
            })
            .catch(err => console.error(err));
    });

    // SECTION 5: Valuation Section
    const valuationTradesTable = document.getElementById('valuationTradesTable').querySelector('tbody');
    const selectAllTradesButton = document.getElementById('selectAllTradesButton');
    const clearAllTradesButton = document.getElementById('clearAllTradesButton');

    const valuationForm = document.getElementById('valuationForm');
    const valSteps = document.getElementById('valSteps');
    const valSimulations = document.getElementById('valSimulations');
    const valAntithetic = document.getElementById('valAntithetic');
    const valControlVariate = document.getElementById('valControlVariate');
    const valMultithreaded = document.getElementById('valMultithreaded');
    const valUseVDCSequence = document.getElementById('valUseVDCSequence');
    const valBase1 = document.getElementById('valBase1');
    const valBase2 = document.getElementById('valBase2');
    const valuationResultsTable = document.getElementById('valuationResultsTable').querySelector('tbody');

    const valRateCurveSelect = document.getElementById('valRateCurve');

    function loadValuationTrades() {
        fetch(`${BASE_URL}/Trades`)
            .then(res => res.json())
            .then(data => {
                valuationTradesTable.innerHTML = '';
                data.forEach(t => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><input type="checkbox" class="trade-select-chk" value="${t.id}"></td>
                        <td>${t.id}</td>
                        <td>${t.instrument ? t.instrument.symbol : ''}</td>
                        <td>${t.instrument ? (t.instrument.name || '') : ''}</td>
                        <td>${t.quantity}</td>
                        <td>${new Date(t.tradeDate).toLocaleString()}</td>
                        <td>${t.price}</td>
                    `;
                    valuationTradesTable.appendChild(tr);
                });
            })
            .catch(err => console.error(err));
    }

    selectAllTradesButton.addEventListener('click', () => {
        document.querySelectorAll('.trade-select-chk').forEach(chk => {
            chk.checked = true;
        });
    });

    clearAllTradesButton.addEventListener('click', () => {
        document.querySelectorAll('.trade-select-chk').forEach(chk => {
            chk.checked = false;
        });
    });

    function loadAllRateCurvesForValuation() {
        fetch(`${BASE_URL}/RateCurves`)
            .then(res => res.json())
            .then(data => {
                valRateCurveSelect.innerHTML = '';
                if (data.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'No Rate Curves Available';
                    valRateCurveSelect.appendChild(opt);
                } else {
                    data.forEach(rc => {
                        const opt = document.createElement('option');
                        opt.value = rc.id;
                        opt.textContent = rc.name || `Curve ${rc.id}`;
                        valRateCurveSelect.appendChild(opt);
                    });
                }
            })
            .catch(err => console.error(err));
    }

    valuationForm.addEventListener('submit', e => {
        e.preventDefault();
        const selectedTrades = Array.from(document.querySelectorAll('.trade-select-chk'))
            .filter(chk => chk.checked)
            .map(chk => parseInt(chk.value));

        if (selectedTrades.length === 0) {
            alert('Select at least one trade.');
            return;
        }

        const selectedCurveId = parseInt(valRateCurveSelect.value);
        if (isNaN(selectedCurveId)) {
            alert('Please select a valid Rate Curve');
            return;
        }

        const body = {
            tradeIds: selectedTrades,
            steps: parseInt(valSteps.value),
            simulations: parseInt(valSimulations.value),
            antithetic: (valAntithetic.value === 'true'),
            controlVariate: (valControlVariate.value === 'true'),
            multithreaded: (valMultithreaded.value === 'true'),
            useVDCSequence: (valUseVDCSequence.value === 'true'),
            base1: parseInt(valBase1.value),
            base2: parseInt(valBase2.value),
            rateCurveId: selectedCurveId
        };

        fetch(`${BASE_URL}/Valuation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(async res => {
                if(!res.ok) {
                    const text = await res.text();
                    throw new Error(text);
                }
                return res.json();
            })
            .then(result => {
                valuationResultsTable.innerHTML = '';
                result.valuations.forEach(v => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${v.tradeId}</td>
                        <td>${v.instrumentSymbol}</td>
                        <td>${v.instrumentName}</td>
                        <td>${v.price.toFixed(6)}</td>
                        <td>${v.standardError.toFixed(6)}</td>
                        <td>${v.delta.toFixed(6)}</td>
                        <td>${v.gamma.toFixed(6)}</td>
                        <td>${v.vega.toFixed(6)}</td>
                        <td>${v.theta.toFixed(6)}</td>
                        <td>${v.rho.toFixed(6)}</td>
                        <td>${v.volatility.toFixed(6)}</td>
                        <td>${v.riskFreeRate.toFixed(6)}</td>
                    `;
                    valuationResultsTable.appendChild(tr);
                });
            })
            .catch(err => {
                console.error(err);
                alert('Error in valuation: ' + err.message);
            });
    });

    // Initial Loads
    loadUnderlyings();
    loadDerivatives();
    loadTrades();
    loadAllRateCurves();
    loadValuationTrades();
    loadAllRateCurvesForValuation();

    // Rate Curves Details and Chart
    function createRateCurveChart(curveName, points) {
        // If chart exists, destroy first
        if (rateCurveChartInstance) {
            rateCurveChartInstance.destroy();
        }

        const ctx = rateCurveChartCanvas.getContext('2d');
        rateCurveChartCanvas.classList.remove('hidden');

        // Sort points by tenor to ensure the line chart is accurate
        points.sort((a, b) => a.tenor - b.tenor);

        const labels = points.map(p => p.tenor);
        const dataPoints = points.map(p => p.rate);

        rateCurveChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Rate',
                    data: dataPoints,
                    borderColor: '#e67e22',
                    backgroundColor: 'rgba(230,126,34,0.2)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 3
                }]
            },
            options: {
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Tenor (years)', color: '#333' },
                        ticks: { color: '#333' },
                        grid: { color: '#ccc' }
                    },
                    y: {
                        title: { display: true, text: 'Rate', color: '#333' },
                        ticks: { color: '#333' },
                        grid: { color: '#ccc' }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Time Series: ' + curveName,
                        color: '#2c3e50',
                        font: { size: 16 }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                maintainAspectRatio: false
            }
        });
    }

    function clearRateCurveDetails() {
        rateCurveDetailsTableBody.innerHTML = '';
        rateCurveDetailsTable.classList.add('hidden');
        if (rateCurveChartInstance) {
            rateCurveChartInstance.destroy();
            rateCurveChartInstance = null;
        }
        rateCurveChartCanvas.classList.add('hidden');
    }

    // Update the RateCurve Details to include chart creation
    function attachRateCurveDetailsWithChart() {
        document.querySelectorAll('.details-ratecurve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/RateCurves/${id}`)
                    .then(res => res.json())
                    .then(rc => {
                        const points = rc.ratePoints || [];
                        rateCurveDetailsTableBody.innerHTML = '';
                        if (points.length > 0) {
                            points.forEach(p => {
                                const row = document.createElement('tr');
                                row.innerHTML = `
                                    <td>${rc.name || ''}</td>
                                    <td>${p.tenor}</td>
                                    <td>${p.rate}</td>
                                `;
                                rateCurveDetailsTableBody.appendChild(row);
                            });
                            rateCurveDetailsTable.classList.remove('hidden');
                            // Create chart
                            createRateCurveChart(rc.name || `Curve ${rc.id}`, points);
                        } else {
                            rateCurveDetailsTableBody.innerHTML = '<tr><td colspan="3">No rate points found.</td></tr>';
                            rateCurveDetailsTable.classList.remove('hidden');
                            // No data for chart
                            if (rateCurveChartInstance) {
                                rateCurveChartInstance.destroy();
                                rateCurveChartInstance = null;
                            }
                            rateCurveChartCanvas.classList.add('hidden');
                        }
                    })
                    .catch(err => console.error(err));
            });
        });
    }

    // Modify attachRateCurveActions to include the chart functionality
    function attachRateCurveActions() {
        document.querySelectorAll('.delete-ratecurve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Delete this RateCurve?')) {
                    fetch(`${BASE_URL}/RateCurves/${id}`, { method: 'DELETE' })
                        .then(() => {
                            btn.closest('tr').remove();
                            loadAllRateCurvesForValuation();
                            clearRateCurveDetails();
                        })
                        .catch(err => console.error(err));
                }
            });
        });

        document.querySelectorAll('.edit-ratecurve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/RateCurves/${id}`)
                    .then(res => res.json())
                    .then(rc => {
                        editRateCurveId.value = rc.id;
                        editRateCurveName.value = rc.name || '';
                        editRateCurveForm.classList.remove('hidden');
                    })
                    .catch(err => console.error(err));
            });
        });

        document.querySelectorAll('.details-ratecurve-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                fetch(`${BASE_URL}/RateCurves/${id}`)
                    .then(res => res.json())
                    .then(rc => {
                        const points = rc.ratePoints || [];
                        rateCurveDetailsTableBody.innerHTML = '';
                        if (points.length > 0) {
                            points.forEach(p => {
                                const row = document.createElement('tr');
                                row.innerHTML = `
                                    <td>${rc.name || ''}</td>
                                    <td>${p.tenor}</td>
                                    <td>${p.rate}</td>
                                `;
                                rateCurveDetailsTableBody.appendChild(row);
                            });
                            rateCurveDetailsTable.classList.remove('hidden');
                            // Create chart
                            createRateCurveChart(rc.name || `Curve ${rc.id}`, points);
                        } else {
                            rateCurveDetailsTableBody.innerHTML = '<tr><td colspan="3">No rate points found.</td></tr>';
                            rateCurveDetailsTable.classList.remove('hidden');
                            // Again if there is no data for chart
                            if (rateCurveChartInstance) {
                                rateCurveChartInstance.destroy();
                                rateCurveChartInstance = null;
                            }
                            rateCurveChartCanvas.classList.add('hidden');
                        }
                    })
                    .catch(err => console.error(err));
            });
        });
    }

    // ... Overriding the 'attachRateCurveActions' including charts
    // Removing previous attachRateCurveActions call inside loadAllRateCurves
    // and use the updated one here.

    // Initial load with updated attachRateCurveActions
    function loadAllRateCurves() {
        fetch(`${BASE_URL}/RateCurves`)
            .then(res => {
                if(!res.ok) throw new Error('Error fetching all RateCurves.');
                return res.json();
            })
            .then(data => {
                rateCurvesTable.innerHTML = '';
                if (data.length === 0) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td colspan="4">No RateCurves found.</td>`;
                    rateCurvesTable.appendChild(tr);
                } else {
                    data.forEach(rc => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${rc.id}</td>
                            <td>${rc.name || ''}</td>
                            <td>${rc.ratePoints ? rc.ratePoints.length : 0}</td>
                            <td>
                                <button data-id="${rc.id}" class="edit-ratecurve-btn">Edit</button>
                                <button data-id="${rc.id}" class="details-ratecurve-btn">See Details</button>
                                <button data-id="${rc.id}" class="delete-ratecurve-btn">Delete</button>
                            </td>
                        `;
                        rateCurvesTable.appendChild(tr);
                    });
                    attachRateCurveActions(); // Now includes chart functionality...
                }
            })
            .catch(err => console.error(err));
    }
});
