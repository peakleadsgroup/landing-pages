/* B2B System Sales Ops — InternalApps client */
(function () {
  "use strict";

  var API_BASE = "/api/system-sales";

  function $(id) { return document.getElementById(id); }

  function pill(status) {
    var m = {
      active: "p-active",
      stopped: "p-stopped",
      paused: "p-paused",
      completed_no_reply: "p-done",
      completed_failed: "p-done"
    };
    return '<span class="pill ' + (m[status] || "") + '">' + esc(status || "?") + "</span>";
  }

  function chpill(ch) {
    if (!ch) return "";
    return '<span class="pill ' + (ch === "sms" ? "p-sms" : "p-email") + '">' + esc(ch) + "</span>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    return String(iso).replace("T", " ").slice(0, 16);
  }

  async function j(path, opts) {
    var r = await fetch(API_BASE + path, opts || {});
    var t;
    try { t = await r.json(); } catch (e) { t = { detail: "non-json response " + r.status }; }
    if (!r.ok) {
      var detail = t.detail || t.error || JSON.stringify(t);
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return t;
  }

  async function refresh() {
    try {
      var p = await j("/pipeline");
      var h = await j("/health");
      var banner = $("banner");
      banner.className = "banner ok";
      banner.textContent =
        "armed=" + h.armed +
        " · enrolled=" + h.enrolled +
        " · source=" + ((p.enroll_meta && p.enroll_meta.source) || "—") +
        " · live sends only via tick --write when armed";
      var bs = p.by_status || {};
      $("kpis").innerHTML = [
        ["Active", bs.active || 0, "in sequence"],
        ["Stopped", bs.stopped || 0, "hot " + (p.hot || 0)],
        ["Completed", (bs.completed_no_reply || 0) + (bs.completed_failed || 0), "finished"],
        ["Paused", bs.paused || 0, p.paused_global ? "GLOBAL PAUSE" : "ok"]
      ].map(function (row) {
        return '<div class="card"><div class="k">' + row[0] + '</div><div class="v">' + row[1] +
          '</div><div class="s">' + row[2] + "</div></div>";
      }).join("");

      var up = p.upcoming_2h || [];
      $("upn").textContent = up.length + " due";
      $("upcoming").innerHTML = up.map(function (x) {
        return "<tr>" +
          '<td class="mono">' + esc(fmtWhen(x.next_at)) + "</td>" +
          "<td>" + esc(x.business) + "</td>" +
          "<td>" + esc(x.next_step || "") + "</td>" +
          "<td>" + chpill(x.next_channel) + "</td>" +
          "<td>" + esc(x.rank || "") + "</td></tr>";
      }).join("") || '<tr><td colspan="5" style="color:var(--soft)">None in next 2h</td></tr>';

      var hot = p.hot_leads || [];
      $("hotn").textContent = String(hot.length);
      $("hot").innerHTML = hot.map(function (x) {
        return "<tr>" +
          '<td class="hot">' + esc(x.business) + "</td>" +
          "<td>" + esc(x.stop_reason) + "</td>" +
          '<td class="mono">' + esc(x.last_inbound_preview || "") + "</td></tr>";
      }).join("") || '<tr><td colspan="3" style="color:var(--soft)">No hot stops</td></tr>';

      await loadLeads();
    } catch (e) {
      var b = $("banner");
      b.className = "banner err";
      b.textContent = "Error: " + e.message;
    }
  }

  async function loadLeads() {
    var q = $("q").value.trim();
    var st = $("status").value;
    var u = new URL(API_BASE + "/leads", location.origin);
    if (q) u.searchParams.set("q", q);
    if (st) u.searchParams.set("status", st);
    u.searchParams.set("limit", "300");
    var path = u.pathname.replace(API_BASE, "") + u.search;
    var data = await j(path);
    $("leadn").textContent = data.n + " shown";
    $("leads").innerHTML = (data.leads || []).map(function (e) {
      return "<tr>" +
        "<td>" + esc(e.rank == null ? "" : e.rank) + "</td>" +
        "<td><strong>" + esc(e.business) + '</strong><div class="mono">' +
        esc(e.phone) + " · " + esc(e.email) + "</div></td>" +
        "<td>" + pill(e.status) + (e.hot ? ' <span class="hot">HOT</span>' : "") + "</td>" +
        "<td>" + (e.next_step ? ("S" + e.next_step + " " + chpill(e.next_channel)) : "—") +
        '<div class="mono">' + esc(fmtWhen(e.next_at)) + "</div></td>" +
        "<td>" + (e.revenue != null ? Number(e.revenue).toLocaleString() : "—") + "</td>" +
        "<td>" + (e.msgs_out || 0) + "/" + (e.msgs_in || 0) + "</td>" +
        '<td><button type="button" class="btn secondary" data-open="' + esc(e.record_id) + '">Open</button></td>' +
        "</tr>";
    }).join("") || '<tr><td colspan="7" style="color:var(--soft)">No leads — run mock --write-state</td></tr>';
  }

  async function openLead(id) {
    var data = await j("/leads/" + encodeURIComponent(id));
    var e = data.lead;
    $("detail").classList.add("open");
    $("dtitle").textContent = e.business || id;
    var tl = (data.timeline || []).map(function (t) {
      return "<tr>" +
        '<td class="mono">' + esc(fmtWhen(t.at) + ((t.at || "").length > 16 ? (t.at || "").slice(16, 19) : "")) + "</td>" +
        "<td>" + esc(t.type) + "</td>" +
        "<td>" + (t.step != null ? ("S" + t.step) : "") + " " + (t.channel ? chpill(t.channel) : "") + "</td>" +
        '<td class="mono">' + esc(t.subject || t.reason || t.preview || t.message_id || "") + "</td></tr>";
    }).join("") || '<tr><td colspan="4" style="color:var(--soft)">No events</td></tr>';

    $("dbody").innerHTML =
      '<div class="mono" style="margin-bottom:10px">' + esc(e.record_id) +
      " · rank " + esc(e.rank) + " · " + esc(e.discovery_status || "") +
      " · " + esc(e.contact_name || "") + "</div>" +
      '<div class="actions" style="margin-bottom:12px">' +
      '<button type="button" class="btn secondary" data-act="pause" data-id="' + esc(e.record_id) + '">Pause</button>' +
      '<button type="button" class="btn secondary" data-act="resume" data-id="' + esc(e.record_id) + '">Resume</button>' +
      '<button type="button" class="btn secondary" data-act="skip" data-id="' + esc(e.record_id) + '">Skip step</button>' +
      '<button type="button" class="btn danger" data-act="stop" data-id="' + esc(e.record_id) + '">Force stop</button>' +
      "</div>" +
      "<div style=\"margin-bottom:8px\">" + pill(e.status) +
      " next S" + esc(e.next_step || "—") + " " + chpill(e.next_channel) +
      ' <span class="mono">' + esc(e.next_at || "") + "</span></div>" +
      '<div class="mono" style="margin-bottom:12px">stop: ' + esc(e.stop_reason || "—") + "</div>" +
      "<table><thead><tr><th>When</th><th>Type</th><th>Step</th><th>Detail</th></tr></thead><tbody>" +
      tl + "</tbody></table>";
    $("detail").scrollIntoView({ behavior: "smooth" });
  }

  async function act(id, kind) {
    try {
      var url = "/leads/" + encodeURIComponent(id) + "/" + kind;
      if (kind === "stop") url += "?reason=manual";
      await j(url, { method: "POST" });
      await refresh();
      await openLead(id);
    } catch (e) {
      alert(e.message);
    }
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!(t instanceof Element)) return;
    var open = t.getAttribute("data-open");
    if (open) { openLead(open); return; }
    var kind = t.getAttribute("data-act");
    var id = t.getAttribute("data-id");
    if (kind && id) act(id, kind);
  });

  $("refresh-btn").addEventListener("click", refresh);
  $("reload-btn").addEventListener("click", function () { loadLeads().catch(function (e) { alert(e.message); }); });
  $("close-detail").addEventListener("click", function () { $("detail").classList.remove("open"); });
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") loadLeads().catch(function (err) { alert(err.message); }); });
  $("status").addEventListener("change", function () { loadLeads().catch(function (e) { alert(e.message); }); });

  refresh();
  setInterval(refresh, 30000);
})();
