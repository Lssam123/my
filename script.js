document.getElementById("budget-form").addEventListener("submit", function (e) {
  e.preventDefault();

  const income = parseFloat(document.getElementById("income").value);
  const categories = ["food", "transport", "entertainment", "bills", "other"];
  const expenses = categories.map(id => parseFloat(document.getElementById(id).value) || 0);
  const totalExpenses = expenses.reduce((a, b) => a + b, 0);
  const remaining = income - totalExpenses;
  const savingRate = income > 0 ? ((remaining / income) * 100).toFixed(2) : "0";

  document.getElementById("remaining").textContent = remaining.toFixed(2);
  document.getElementById("savingRate").textContent = savingRate;
  document.getElementById("result").classList.remove("hidden");
  document.getElementById("export-pdf").classList.remove("hidden");

  const history = JSON.parse(localStorage.getItem("financeHistory")) || [];
  history.push({
    date: new Date().toLocaleDateString(),
    income: income.toFixed(2),
    expenses: totalExpenses.toFixed(2),
    remaining: remaining.toFixed(2)
  });
  localStorage.setItem("financeHistory", JSON.stringify(history));
  renderHistory(history);

  const ctx = document.getElementById("expenseChart").getContext("2d");
  if (window.expenseChart) window.expenseChart.destroy();
  window.expenseChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: ["أكل", "مواصلات", "ترفيه", "فواتير", "أخرى"],
      datasets: [{
        data: expenses,
        backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4CAF50", "#9C27B0"]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        title: { display: true, text: 'توزيع المصاريف' }
      }
    }
  });
});

function renderHistory(data) {
  const tbody = document.getElementById("history-body");
  tbody.innerHTML = "";
  data.slice().reverse().forEach(entry => {
    const row = `<tr>
      <td>${entry.date}</td>
      <td>${entry.income}</td>
      <td>${entry.expenses}</td>
      <td>${entry.remaining}</td>
    </tr>`;
    tbody.innerHTML += row;
  });
  document.getElementById("history").classList.remove("hidden");
}

document.getElementById("export-pdf").addEventListener("click", async () => {
  const { jsPDF } = window.jspdf;
  const
