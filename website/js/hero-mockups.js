/**
 * HTML mock UIs for hero device carousels (demo data only, no personal info).
 */
(function () {
  const MOBILE_DAYBOOK = `
<div class="pl-mock pl-mock--phone">
  <div class="pl-mock-top">
    <div class="pl-mock-top-company"><i></i><span>Demo Trading Co.</span></div>
    <div class="pl-mock-top-actions"><span class="pl-mock-pill">BS</span><span class="pl-mock-avatar"></span></div>
  </div>
  <div class="pl-mock-scroll">
    <h2 class="pl-mock-title">Daybook</h2>
    <p class="pl-mock-sub">All transactions for the selected date</p>
    <div class="pl-mock-card">
      <div class="pl-mock-card-head">Daily Summary · Bank &amp; Cash</div>
      <table class="pl-mock-table">
        <thead><tr><th>Account</th><th>Open</th><th>In</th><th>Out</th><th>Bal</th></tr></thead>
        <tbody>
          <tr><td>Bank</td><td>3,45,000</td><td class="pl-mock-in">18,500</td><td class="pl-mock-out">9,200</td><td>3,54,300</td></tr>
          <tr><td>Cash</td><td>42,800</td><td class="pl-mock-in">6,400</td><td class="pl-mock-out">2,100</td><td>47,100</td></tr>
          <tr><td>Total</td><td>3,87,800</td><td class="pl-mock-in">24,900</td><td class="pl-mock-out">11,300</td><td>4,01,400</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pl-mock-voucher">
      <div class="pl-mock-voucher-head">PYMT-0266 · payment out · Demo Staff A</div>
      <div class="pl-mock-voucher-meta"><span>Salary payment</span><span class="pl-mock-voucher-amt">50,000</span></div>
    </div>
    <div class="pl-mock-voucher">
      <div class="pl-mock-voucher-head">RCPT-0198 · payment in · Demo Party B</div>
      <div class="pl-mock-voucher-meta"><span>Amount received in bank</span><span class="pl-mock-voucher-amt">1,25,000</span></div>
    </div>
  </div>
  <div class="pl-mock-tabs">
    <span class="pl-mock-tab t-all">All</span><span class="pl-mock-tab t-sum">Summary</span><span class="pl-mock-tab t-bank">Bank</span>
    <span class="pl-mock-tab t-day">Daybook</span><span class="pl-mock-tab t-rec">Recent</span><span class="pl-mock-tab t-chart">Chart</span>
  </div>
</div>`;

  const MOBILE_PARTIES = `
<div class="pl-mock pl-mock--phone">
  <div class="pl-mock-top">
    <div class="pl-mock-top-company"><i></i><span>Demo Trading Co.</span></div>
    <div class="pl-mock-top-actions"><span class="pl-mock-pill">BS</span><span class="pl-mock-avatar"></span></div>
  </div>
  <div class="pl-mock-scroll">
    <h2 class="pl-mock-title">Parties</h2>
    <p class="pl-mock-sub">To Receive · 4,82,500 Cr</p>
    <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial a">DA</span><span class="pl-mock-name">Demo Agency Pvt. Ltd.</span></div><span class="pl-mock-amt cr">2,15,400 Cr</span></div>
    <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial b">DB</span><span class="pl-mock-name">Demo Builders &amp; Suppliers</span></div><span class="pl-mock-amt cr">1,08,200 Cr</span></div>
    <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial c">DC</span><span class="pl-mock-name">Demo Cement Traders</span></div><span class="pl-mock-amt dr">86,500 Dr</span></div>
    <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial d">DD</span><span class="pl-mock-name">Demo Hardware Store</span></div><span class="pl-mock-amt cr">62,800 Cr</span></div>
    <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial e">DE</span><span class="pl-mock-name">Demo Electric Works</span></div><span class="pl-mock-amt dr">41,200 Dr</span></div>
    <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial a">DF</span><span class="pl-mock-name">Demo Furniture Mart</span></div><span class="pl-mock-amt cr">38,600 Cr</span></div>
    <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial b">DG</span><span class="pl-mock-name">Demo General Store</span></div><span class="pl-mock-amt cr">28,400 Cr</span></div>
  </div>
  <div class="pl-mock-tabs">
    <span class="pl-mock-tab t-all">Parties</span><span class="pl-mock-tab t-sum">Groups</span><span class="pl-mock-tab t-bank">IC</span>
    <span class="pl-mock-tab t-day">Add</span><span class="pl-mock-tab t-rec">Filter</span><span class="pl-mock-tab t-chart">Search</span>
  </div>
</div>`;

  const MOBILE_PARTY = `
<div class="pl-mock pl-mock--phone">
  <div class="pl-mock-top">
    <div class="pl-mock-top-company"><i></i><span>Demo Trading Co.</span></div>
    <div class="pl-mock-top-actions"><span class="pl-mock-pill">BS</span><span class="pl-mock-avatar"></span></div>
  </div>
  <div class="pl-mock-scroll">
    <h2 class="pl-mock-title">Party details</h2>
    <p class="pl-mock-sub">Demo Agency Pvt. Ltd.</p>
    <div class="pl-mock-balance-bar">To Receive · 2,15,400.00</div>
    <div class="pl-mock-voucher">
      <div class="pl-mock-voucher-head">Sale Inv-047 · sale · Sales Account</div>
      <div class="pl-mock-voucher-meta"><span>Bill no. 41 · materials</span><span class="pl-mock-voucher-amt">1,85,000</span></div>
    </div>
    <div class="pl-mock-voucher">
      <div class="pl-mock-voucher-head">RCPT-019 · payment in · Demo Bank</div>
      <div class="pl-mock-voucher-meta"><span>Received by online transfer</span><span class="pl-mock-voucher-amt">75,000</span></div>
    </div>
    <div class="pl-mock-voucher">
      <div class="pl-mock-voucher-head">JRNL-025 · journal · Hisab Milan</div>
      <div class="pl-mock-voucher-meta"><span>Opening adjustment</span><span class="pl-mock-voucher-amt">44,600</span></div>
    </div>
  </div>
  <div class="pl-mock-tabs">
    <span class="pl-mock-tab t-all">Bill wise</span><span class="pl-mock-tab t-sum">Receive</span><span class="pl-mock-tab t-bank">Pay</span>
    <span class="pl-mock-tab t-day">New Sale</span><span class="pl-mock-tab t-rec">Stmt</span><span class="pl-mock-tab t-chart">More</span>
  </div>
</div>`;

  const PC_DASHBOARD = `
<div class="pl-mock pl-mock--desktop pl-mock-desk">
  <aside class="pl-mock-sidebar">
    <div class="pl-mock-logo"><i></i> Pocket Ledger</div>
    <div class="pl-mock-nav">
      <span class="on">Dashboard</span><span>Parties</span><span>Bank/Cash</span><span>Staff</span><span>Tax</span><span>Reports</span>
    </div>
    <div class="pl-mock-sidebar-foot">Demo Trading Co.</div>
  </aside>
  <div class="pl-mock-main">
    <div class="pl-mock-toolbar">
      <b>Add Sale</b><b>Add Purchase</b><b>Receipt</b><b>Payment</b><b>Journal</b><b>Add Party</b>
    </div>
    <div class="pl-mock-dash-grid">
      <div class="pl-mock-dash-card c-blue"><h4>Auto Recurring</h4><p>12,48,500</p><small>Inflow · Outflow · Balance</small></div>
      <div class="pl-mock-dash-card c-green"><h4>Outstanding</h4><p>8,65,200</p><small>To Receive · To Pay</small></div>
      <div class="pl-mock-dash-card c-orange"><h4>Cash Flow</h4><p>4,22,800</p><small>Receipt · Payment</small></div>
      <div class="pl-mock-dash-card c-purple"><h4>Tax Summary</h4><p>1,18,400</p><small>Paid · Received</small></div>
      <div class="pl-mock-dash-card c-teal span-2"><h4>Bank &amp; Cash</h4><p>15,42,600</p><small>Bank 14,80,000 · Cash 62,600</small></div>
      <div class="pl-mock-dash-card c-pink"><h4>Sales</h4><p>6,24,000</p><small>32 vouchers</small></div>
      <div class="pl-mock-dash-card c-slate"><h4>Purchases</h4><p>3,18,500</p><small>18 vouchers</small></div>
    </div>
  </div>
</div>`;

  const PC_STAFF = `
<div class="pl-mock pl-mock--desktop pl-mock-desk">
  <aside class="pl-mock-sidebar">
    <div class="pl-mock-logo"><i></i> Pocket Ledger</div>
    <div class="pl-mock-nav">
      <span>Dashboard</span><span>Parties</span><span>Bank/Cash</span><span class="on">Staff</span><span>Tax</span>
    </div>
    <div class="pl-mock-sidebar-foot">Demo Trading Co.</div>
  </aside>
  <div class="pl-mock-main">
    <div class="pl-mock-toolbar"><b>Add Salary</b><b>Pay Salary</b><b>Payment</b><b>Journal</b></div>
    <div class="pl-mock-staff-body">
      <div class="pl-mock-staff-list">
        <h4>Staff · 5,97,000 Cr</h4>
        <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial a">SA</span><span class="pl-mock-name">Demo Staff A</span></div><span class="pl-mock-amt cr">1,42,000</span></div>
        <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial b">SB</span><span class="pl-mock-name">Demo Staff B</span></div><span class="pl-mock-amt dr">3,980</span></div>
        <div class="pl-mock-row"><div class="pl-mock-row-left"><span class="pl-mock-initial c">SC</span><span class="pl-mock-name">Demo Staff C</span></div><span class="pl-mock-amt cr">88,400</span></div>
      </div>
      <div class="pl-mock-staff-detail">
        <h4>Demo Staff B · 3,979.55 Dr</h4>
        <table class="pl-mock-ledger-table">
          <thead><tr><th>Date</th><th>Type</th><th>Voucher</th><th>Debit</th><th>Credit</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>2083-02-22</td><td><span class="pl-mock-tag sal">Salary</span></td><td>SAL-012</td><td>28,000</td><td>—</td><td><span class="pl-mock-tag paid">Paid</span></td></tr>
            <tr><td>2083-02-08</td><td><span class="pl-mock-tag pay">Pay out</span></td><td>PYMT-128</td><td>2,000</td><td>—</td><td><span class="pl-mock-tag paid">Paid</span></td></tr>
            <tr><td>2083-01-15</td><td><span class="pl-mock-tag pay">Pay in</span></td><td>RCPT-044</td><td>—</td><td>5,000</td><td><span class="pl-mock-tag paid">Paid</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;

  const MOCKS = {
    daybook: MOBILE_DAYBOOK,
    parties: MOBILE_PARTIES,
    party: MOBILE_PARTY,
    dashboard: PC_DASHBOARD,
    staff: PC_STAFF,
  };

  function applyMock(el) {
    if (!el) return;
    const key = el.dataset.mock;
    const variant = el.dataset.mockVariant || "phone";
    el.innerHTML = MOCKS[key] || "";
    const mock = el.querySelector(".pl-mock");
    if (!mock) return;
    mock.classList.remove("pl-mock--phone", "pl-mock--tablet", "pl-mock--desktop");
    if (variant === "tablet") mock.classList.add("pl-mock--tablet");
    else if (variant === "desktop") mock.classList.add("pl-mock--desktop");
    else mock.classList.add("pl-mock--phone");
  }

  document.querySelectorAll("[data-mock]").forEach(applyMock);
})();
