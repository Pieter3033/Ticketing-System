(function () {
  const mount = document.querySelector("#dashboardUserBreakdown");
  const React = window.React;
  const ReactDOM = window.ReactDOM;

  if (!mount || !React || !ReactDOM || !ReactDOM.createRoot) {
    window.dashboardUserBarsReady = false;
    return;
  }

  const { createElement: h, useEffect, useMemo, useState } = React;
  const root = ReactDOM.createRoot(mount);
  let latestPayload = { users: [], rangeLabel: "" };
  let pushPayload = null;

  window.renderDashboardUserBars = function renderDashboardUserBars(payload) {
    latestPayload = payload || { users: [], rangeLabel: "" };
    if (pushPayload) {
      pushPayload(latestPayload);
    }
  };

  window.dashboardUserBarsReady = true;

  function formatNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString() : "0";
  }

  function chartLabels(payload) {
    return {
      empty: "No user tickets or contributions match the dashboard filters.",
      event: "Total tickets",
      contribution: "Total contributions",
      averageEvent: "Avg tickets",
      averageContribution: "Avg contributions",
      axis: "Total tickets and contributions",
      aria: "Bar chart of total tickets and total contributions by user",
      meta: "Users",
      ...(window.dashboardUserBarsLabels || {}),
      ...(payload?.labels || {})
    };
  }

  function getTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function useTheme() {
    const [theme, setTheme] = useState(getTheme);

    useEffect(() => {
      const observer = new MutationObserver(() => setTheme(getTheme()));
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
      });
      return () => observer.disconnect();
    }, []);

    return theme;
  }

  function EmptyState() {
    return h("p", { className: "dashboard-empty" }, chartLabels(latestPayload).empty);
  }

  function truncateLabel(value, length) {
    const label = String(value || "Unassigned");
    return label.length > length ? `${label.slice(0, Math.max(length - 1, 3))}...` : label;
  }

  function niceMax(value) {
    const number = Math.max(Number(value || 0), 1);
    if (number <= 5) return 5;
    const power = Math.pow(10, Math.floor(Math.log10(number)));
    return Math.ceil(number / power) * power;
  }

  function UserBarsApp() {
    const [payload, setPayload] = useState(latestPayload);
    const [tooltip, setTooltip] = useState(null);
    const theme = useTheme();
    const isLight = theme === "light";

    useEffect(() => {
      function handleUserBars(event) {
        latestPayload = event.detail || { users: [], rangeLabel: "" };
        setPayload(latestPayload);
      }
      pushPayload = setPayload;
      setPayload(latestPayload);
      window.addEventListener("dashboard:user-bars", handleUserBars);
      return () => {
        if (pushPayload === setPayload) {
          pushPayload = null;
        }
        window.removeEventListener("dashboard:user-bars", handleUserBars);
      };
    }, []);

    const users = Array.isArray(payload.users) ? payload.users : [];
    const labels = chartLabels(payload);
    const chart = useMemo(() => {
      const userCount = users.length;
      const dense = userCount > 28;
      const compact = userCount > 16;
      const medium = userCount > 8;
      const chartTop = 22;
      const chartHeight = dense ? 196 : compact ? 210 : 224;
      const chartLeft = 74;
      const chartBottom = dense ? 96 : 104;
      const groupWidth = dense ? 48 : compact ? 58 : medium ? 70 : 84;
      const barWidth = dense ? 12 : compact ? 15 : medium ? 18 : 22;
      const barGap = dense ? 4 : compact ? 5 : 6;
      const labelLength = dense ? 8 : compact ? 10 : medium ? 13 : 16;
      const plotWidth = Math.max(userCount * groupWidth, 520);
      const width = chartLeft + plotWidth + 24;
      const height = chartTop + chartHeight + chartBottom;
      const averageEvents = users.reduce((sum, user) => sum + Number(user.eventCount || 0), 0) / Math.max(userCount, 1);
      const averageContributions = users.reduce((sum, user) => sum + Number(user.contributionCount || 0), 0) / Math.max(userCount, 1);
      const maxValue = niceMax(Math.max(...users.flatMap((user) => [
        Number(user.eventCount || 0),
        Number(user.contributionCount || 0)
      ]), averageEvents, averageContributions, 1));
      const ticks = [0, .25, .5, .75, 1].map((ratio) => Math.round(maxValue * ratio));
      const colors = {
        axis: isLight ? "#4b5f77" : "#9eb2c8",
        grid: isLight ? "rgba(20, 32, 51, .12)" : "rgba(226, 232, 240, .12)",
        label: isLight ? "#142033" : "#f5f9ff",
        events: "#3b82f6",
        contributions: "#6366f1"
      };

      return {
        chartTop,
        chartHeight,
        chartLeft,
        chartBottom,
        groupWidth,
        barWidth,
        barGap,
        labelLength,
        plotWidth,
        width,
        height,
        maxValue,
        averageEvents,
        averageContributions,
        ticks,
        colors
      };
    }, [users, isLight]);

    if (!users.length) {
      return h(EmptyState);
    }

    return h("div", { className: "dashboard-react-shell" },
      h("div", { className: "dashboard-react-legend" },
        h("span", null, h("i", { className: "dashboard-react-dot dashboard-react-dot-blue" }), labels.event),
        h("span", null, h("i", { className: "dashboard-react-dot dashboard-react-dot-indigo" }), labels.contribution),
        h("span", null, h("i", { className: "dashboard-react-line dashboard-react-line-blue" }), labels.averageEvent),
        h("span", null, h("i", { className: "dashboard-react-line dashboard-react-line-indigo" }), labels.averageContribution)
      ),
      h("div", { className: "dashboard-react-scroll", role: "img", "aria-label": labels.aria },
        h("svg", {
          className: "dashboard-react-svg",
          viewBox: `0 0 ${chart.width} ${chart.height}`,
          style: { minWidth: `${chart.width}px` },
          preserveAspectRatio: "xMinYMin meet",
          "aria-hidden": "true"
        },
          h("text", {
            x: 18,
            y: chart.chartTop + (chart.chartHeight / 2),
            transform: `rotate(-90 18 ${chart.chartTop + (chart.chartHeight / 2)})`,
            textAnchor: "middle",
            fill: chart.colors.axis,
            fontSize: "12",
            fontWeight: "900"
          }, labels.axis),
          h("line", {
            x1: chart.chartLeft,
            y1: chart.chartTop,
            x2: chart.chartLeft,
            y2: chart.chartTop + chart.chartHeight,
            className: "dashboard-react-axis-line",
            stroke: chart.colors.axis
          }),
          h("line", {
            x1: chart.chartLeft,
            y1: chart.chartTop + chart.chartHeight,
            x2: chart.width - 18,
            y2: chart.chartTop + chart.chartHeight,
            className: "dashboard-react-axis-line",
            stroke: chart.colors.axis
          }),
          ...chart.ticks.map((tick) => {
            const y = chart.chartTop + chart.chartHeight - ((tick / chart.maxValue) * chart.chartHeight);
            return h(React.Fragment, { key: `tick-${tick}` },
              h("line", {
                x1: chart.chartLeft,
                y1: y,
                x2: chart.width - 18,
                y2: y,
                stroke: chart.colors.grid,
                strokeWidth: "1"
              }),
              h("text", {
                x: chart.chartLeft - 12,
                y: y + 4,
                textAnchor: "end",
                fill: chart.colors.axis,
                fontSize: "11",
                fontWeight: "800"
              }, formatNumber(tick))
            );
          }),
          ...[
            { key: "avg-events", value: chart.averageEvents, color: chart.colors.events, label: `${labels.averageEvent} ${formatNumber(Math.round(chart.averageEvents))}` },
            { key: "avg-contributions", value: chart.averageContributions, color: chart.colors.contributions, label: `${labels.averageContribution} ${formatNumber(Math.round(chart.averageContributions))}` }
          ].map((average) => {
            const y = chart.chartTop + chart.chartHeight - ((average.value / chart.maxValue) * chart.chartHeight);
            return h(React.Fragment, { key: average.key },
              h("line", {
                x1: chart.chartLeft,
                y1: y,
                x2: chart.width - 18,
                y2: y,
                stroke: average.color,
                strokeWidth: "2",
                strokeDasharray: "6 5",
                opacity: ".88"
              }),
              h("text", {
                x: chart.width - 22,
                y: y - 6,
                textAnchor: "end",
                fill: average.color,
                fontSize: "10",
                fontWeight: "900"
              }, average.label)
            );
          }),
          ...users.map((user, index) => {
            const groupX = chart.chartLeft + (index * chart.groupWidth) + Math.max(10, Math.round((chart.groupWidth - ((chart.barWidth * 2) + chart.barGap)) / 2));
            const eventValue = Number(user.eventCount || 0);
            const contributionValue = Number(user.contributionCount || 0);
            const eventHeight = Math.max(eventValue ? 4 : 0, (eventValue / chart.maxValue) * chart.chartHeight);
            const contributionHeight = Math.max(contributionValue ? 4 : 0, (contributionValue / chart.maxValue) * chart.chartHeight);
            const baseline = chart.chartTop + chart.chartHeight;
            const groupCenter = groupX + chart.barWidth + (chart.barGap / 2);
            const updateTooltip = (event) => {
              const tooltipWidth = 250;
              const tooltipHeight = 132;
              const x = Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - 12);
              const y = Math.min(event.clientY + 14, window.innerHeight - tooltipHeight - 12);
              setTooltip({ user, x, y });
            };
            return h("g", {
              key: user.key,
              className: "dashboard-react-group",
              onPointerEnter: updateTooltip,
              onPointerMove: updateTooltip,
              onPointerLeave: () => setTooltip(null)
            },
              h("rect", {
                x: chart.chartLeft + (index * chart.groupWidth),
                y: chart.chartTop,
                width: chart.groupWidth,
                height: chart.chartHeight + 54,
                fill: "transparent",
                pointerEvents: "all"
              }),
              h("rect", {
                key: `${user.key}-event-bg`,
                x: groupX,
                y: chart.chartTop,
                width: chart.barWidth,
                height: chart.chartHeight,
                rx: "8",
                className: "dashboard-react-bar-bg"
              }),
              h("rect", {
                key: `${user.key}-contribution-bg`,
                x: groupX + chart.barWidth + chart.barGap,
                y: chart.chartTop,
                width: chart.barWidth,
                height: chart.chartHeight,
                rx: "8",
                className: "dashboard-react-bar-bg"
              }),
              h("rect", {
                key: `${user.key}-event`,
                x: groupX,
                y: baseline - eventHeight,
                width: chart.barWidth,
                height: eventHeight,
                rx: "8",
                fill: chart.colors.events,
                className: "dashboard-react-bar"
              }),
              h("rect", {
                key: `${user.key}-contribution`,
                x: groupX + chart.barWidth + chart.barGap,
                y: baseline - contributionHeight,
                width: chart.barWidth,
                height: contributionHeight,
                rx: "8",
                fill: chart.colors.contributions,
                className: "dashboard-react-bar"
              }),
              h("text", {
                key: `${user.key}-event-label`,
                x: groupX + (chart.barWidth / 2),
                y: baseline - eventHeight - 7,
                textAnchor: "middle",
                fill: chart.colors.label,
                fontSize: chart.groupWidth < 58 ? "9" : "10",
                fontWeight: "900"
              }, eventValue ? formatNumber(eventValue) : ""),
              h("text", {
                key: `${user.key}-contribution-label`,
                x: groupX + chart.barWidth + chart.barGap + (chart.barWidth / 2),
                y: baseline - contributionHeight - 7,
                textAnchor: "middle",
                fill: chart.colors.label,
                fontSize: chart.groupWidth < 58 ? "9" : "10",
                fontWeight: "900"
              }, contributionValue ? formatNumber(contributionValue) : ""),
              h("text", {
                key: `${user.key}-name`,
                x: groupCenter,
                y: baseline + 26,
                textAnchor: "end",
                transform: `rotate(-35 ${groupCenter} ${baseline + 26})`,
                fill: chart.colors.label,
                fontSize: "10",
                fontWeight: "900"
              }, truncateLabel(user.userName, chart.labelLength)),
            );
          }),
          h("text", {
            x: chart.chartLeft + (chart.plotWidth / 2),
            y: chart.height - 12,
            textAnchor: "middle",
            fill: chart.colors.axis,
            fontSize: "12",
            fontWeight: "900"
          }, labels.meta)
        )
      ),
      tooltip ? h("div", {
        className: "dashboard-react-tooltip",
        style: { left: `${tooltip.x}px`, top: `${tooltip.y}px` }
      },
        h("strong", null, tooltip.user.userName || "Unassigned"),
        h("span", null, `${labels.event}: `, h("b", null, formatNumber(tooltip.user.eventCount))),
        h("span", null, `${labels.contribution}: `, h("b", null, formatNumber(tooltip.user.contributionCount))),
        h("small", null, `${labels.averageEvent} ${formatNumber(Math.round(chart.averageEvents))} | ${labels.averageContribution} ${formatNumber(Math.round(chart.averageContributions))}`)
      ) : null
    );
  }

  root.render(h(UserBarsApp));
})();
