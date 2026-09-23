return (
  <main className="page">
    {/* TOP HEADER */}
    <header className="topbar">
      <div className="eyebrow">
        ICD/KKF Running Train Details
      </div>

      <div className="top-actions">
        <span className={`live-dot ${loading ? "pulse" : ""}`} />
        <span>{loading ? "Refreshing…" : "Sheet Connected"}</span>

        <button
          className="refresh"
          onClick={() => void load({ force: true })}
          disabled={loading}
        >
          ↻ {loading ? "Loading" : "Refresh"}
        </button>
      </div>
    </header>

    {/* ERROR */}
    {error && (
      <div className="error-banner">
        {error}
      </div>
    )}

    {/* =====================================================
        LIVE MAP — SABSE PAHLE
       ===================================================== */}
    <section className="panel map-panel taptrack-shell">

      <div className="map-topbar">
        <div>
          <div className="panel-kicker">
            ICD / KKF • LIVE OPERATIONS MAP
          </div>

          <h2>
            Running trains • {todayDay}, {todayDate}
          </h2>
        </div>

        <div className="map-status">
          <b>{mapInstances.length} RUNNING</b>
          <span>Live train positions</span>
        </div>
      </div>

      <div className="taptrack-map-stage">

        {/* ACTUAL MAP */}
        <RouteMap
          instances={mapInstances}
          selectedKey={selectedInstance?.key || ""}
          onTrainClick={(key) => setSelectedKey(key)}
        />

        {/* LEFT TRAIN LIST */}
        <div className="map-left-drawer">
          {/* YAHAN AAPKA EXISTING LEFT DRAWER KA
              POORA CODE SAME RAHEGA */}
        </div>

        {/* RIGHT SELECTED TRAIN PANEL */}
        {selectedInstance && (
          <div className="map-right-drawer">
            {/* YAHAN AAPKA EXISTING RIGHT DRAWER KA
                POORA CODE SAME RAHEGA */}
          </div>
        )}

        {/* WATERING ALERTS / LEGEND / ETC.
            AAPKA EXISTING CODE YAHIN RAHEGA */}

      </div>
    </section>

    {/* =====================================================
        TODAY BANNER
       ===================================================== */}
    <section className="today-banner">
      {/* existing today-banner code */}
    </section>

    {/* =====================================================
        STATS
       ===================================================== */}
    <section className="stats">
      {/* existing stats code */}
    </section>

    {/* =====================================================
        TODAY ACTIVE TRAIN INSTANCES
       ===================================================== */}
    <section className="panel today-map-panel">
      {/* existing today-map-panel code */}
    </section>

    {/* =====================================================
        TRAIN DIRECTORY / SELECTED ROUTE / DETAILS
       ===================================================== */}
    <section className="dashboard-grid">
      {/* existing dashboard-grid code */}
    </section>

    {/* =====================================================
        TABLE
       ===================================================== */}
    <section className="table-panel">
      {/* existing table-panel code */}
    </section>

    {/* FOOTER */}
    <footer>
      {/* existing footer */}
    </footer>
  </main>
);