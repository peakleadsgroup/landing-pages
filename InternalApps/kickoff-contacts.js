/**
 * Contacts step for kickoff.html — billing / lead contact migration + management
 */
(function (global) {
  const CONFIG = {
    TABLE_CLIENT: "tblH2nVfmGNG8pAjC",
    TABLE_ADSET: "tblee61crNCoSfurx",
    TABLE_CONTACTS: "tblzbIWvSdazhesWf",
    FIELD_BILLING_CONTACTS: "Billing Contacts",
    FIELD_LEAD_CONTACTS: "Lead Contacts",
    FIELD_NOTIFICATIONS: "Notifications",
    FIELD_NAME: "Name",
    FIELD_EMAIL: "Email",
    FIELD_PHONE: "Phone",
    NOTIF_BILLING: "Billing",
    NOTIF_NEW_LEAD: "New Lead",
    CONTACT_SAVE_DELAY_MS: 1500,
  };

  function create(deps) {
    const fetchJson = deps.fetchJson;
    const airtableUrl = deps.airtableUrl;
    const contactSaveTimers = new Map();

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function fetchAllRecords(table) {
      const records = [];
      let offset = null;
      do {
        let url = airtableUrl(table);
        if (offset) url += "?offset=" + encodeURIComponent(offset);
        const data = await fetchJson(url);
        records.push.apply(records, data.records || []);
        offset = data.offset || null;
      } while (offset);
      return records;
    }

    async function fetchRecordsByIds(table, ids) {
      const unique = (ids || []).filter(function (id, i, a) {
        return id && a.indexOf(id) === i;
      });
      if (!unique.length) return [];
      const chunkSize = 20;
      const out = [];
      for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const formula = "OR(" + chunk.map(function (id) {
          return 'RECORD_ID()="' + id + '"';
        }).join(",") + ")";
        const url = airtableUrl(table) + "?filterByFormula=" + encodeURIComponent(formula);
        const data = await fetchJson(url);
        out.push.apply(out, data.records || []);
      }
      return out;
    }

    async function fetchClient(clientId) {
      return fetchJson(airtableUrl(CONFIG.TABLE_CLIENT) + "/" + encodeURIComponent(clientId));
    }

    async function fetchAdset(adsetId) {
      return fetchJson(airtableUrl(CONFIG.TABLE_ADSET) + "/" + encodeURIComponent(adsetId));
    }

    function normalizeNotifications(raw) {
      if (!raw) return [];
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr.map(function (v) {
        if (v && typeof v === "object" && v.name != null) return String(v.name);
        return String(v);
      });
    }

    function contactLabel(contact) {
      const f = contact.fields || {};
      const name = f[CONFIG.FIELD_NAME] || "Unnamed";
      const email = f[CONFIG.FIELD_EMAIL] || "";
      return email ? name + " — " + email : name;
    }

    function mergeUniqueIds(existing, addIds) {
      const set = new Set(Array.isArray(existing) ? existing : []);
      (addIds || []).forEach(function (id) { if (id) set.add(id); });
      return Array.from(set);
    }

    async function patchClient(clientId, fields) {
      return fetchJson(airtableUrl(CONFIG.TABLE_CLIENT) + "/" + encodeURIComponent(clientId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ fields: fields }),
      });
    }

    async function patchAdset(adsetId, fields) {
      return fetchJson(airtableUrl(CONFIG.TABLE_ADSET) + "/" + encodeURIComponent(adsetId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ fields: fields }),
      });
    }

    async function patchContact(contactId, fields) {
      return fetchJson(airtableUrl(CONFIG.TABLE_CONTACTS) + "/" + encodeURIComponent(contactId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ fields: fields }),
      });
    }

    async function createContact(fields) {
      const data = await fetchJson(airtableUrl(CONFIG.TABLE_CONTACTS), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ records: [{ fields: fields }] }),
      });
      return (data.records && data.records[0]) || null;
    }

    async function addContactToAdsetLeadContacts(adsetId, contactId) {
      const adset = await fetchAdset(adsetId);
      const current = Array.isArray(adset.fields && adset.fields[CONFIG.FIELD_LEAD_CONTACTS])
        ? adset.fields[CONFIG.FIELD_LEAD_CONTACTS]
        : [];
      if (current.indexOf(contactId) >= 0) return adset;
      const fields = {};
      fields[CONFIG.FIELD_LEAD_CONTACTS] = mergeUniqueIds(current, [contactId]);
      return patchAdset(adsetId, fields);
    }

    /**
     * Process Billing Contacts notifications and link to kickoff adsets as specified.
     */
    async function migrateBillingContacts(client, adsets) {
      const billingIds = Array.isArray(client.fields && client.fields[CONFIG.FIELD_BILLING_CONTACTS])
        ? client.fields[CONFIG.FIELD_BILLING_CONTACTS].slice()
        : [];
      if (!billingIds.length || !adsets.length) {
        return { client: client, adsets: adsets.slice() };
      }

      const contacts = await fetchRecordsByIds(CONFIG.TABLE_CONTACTS, billingIds);
      let nextBillingIds = billingIds.slice();
      const updatedAdsetMap = {};

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        const notifs = normalizeNotifications(contact.fields && contact.fields[CONFIG.FIELD_NOTIFICATIONS]);
        const hasBilling = notifs.indexOf(CONFIG.NOTIF_BILLING) >= 0;
        const hasNewLead = notifs.indexOf(CONFIG.NOTIF_NEW_LEAD) >= 0;

        if (hasBilling && !hasNewLead) continue;

        if ((hasBilling && hasNewLead) || (hasNewLead && !hasBilling)) {
          for (let a = 0; a < adsets.length; a++) {
            const adset = adsets[a];
            const updated = await addContactToAdsetLeadContacts(adset.id, contact.id);
            updatedAdsetMap[adset.id] = updated;
            await sleep(120);
          }
        }

        if (hasNewLead && !hasBilling) {
          nextBillingIds = nextBillingIds.filter(function (id) { return id !== contact.id; });
        }
      }

      let nextClient = client;
      if (nextBillingIds.length !== billingIds.length) {
        const fields = {};
        fields[CONFIG.FIELD_BILLING_CONTACTS] = nextBillingIds;
        nextClient = await patchClient(client.id, fields);
      }

      const nextAdsets = adsets.map(function (adset) {
        return updatedAdsetMap[adset.id]
          ? { id: updatedAdsetMap[adset.id].id, fields: updatedAdsetMap[adset.id].fields || {} }
          : adset;
      });

      return { client: nextClient, adsets: nextAdsets };
    }

    function scheduleContactFieldSave(contactId, fieldName, value, inputEl) {
      const key = contactId + ":" + fieldName;
      if (contactSaveTimers.has(key)) clearTimeout(contactSaveTimers.get(key));
      contactSaveTimers.set(key, setTimeout(async function () {
        contactSaveTimers.delete(key);
        try {
          const baseline = inputEl && inputEl.dataset ? inputEl.dataset.savedValue || "" : "";
          if (String(baseline) === String(value == null ? "" : value)) return;
          const fields = {};
          fields[fieldName] = value;
          await patchContact(contactId, fields);
          if (inputEl && inputEl.dataset) inputEl.dataset.savedValue = value;
        } catch (err) {
          console.error("[Kickoff Contacts] save failed", err);
        }
      }, CONFIG.CONTACT_SAVE_DELAY_MS));
    }

    function renderContactRow(contact, removeHandler) {
      const f = contact.fields || {};
      const row = document.createElement("div");
      row.className = "contact-row";
      row.dataset.contactId = contact.id;

      function fieldInput(labelText, fieldName, type, value) {
        const wrap = document.createElement("div");
        wrap.className = "contact-field";
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.type = type;
        input.value = value || "";
        input.dataset.contactId = contact.id;
        input.dataset.contactField = fieldName;
        input.dataset.savedValue = value || "";
        input.addEventListener("input", function () {
          scheduleContactFieldSave(contact.id, fieldName, input.value, input);
        });
        wrap.appendChild(label);
        wrap.appendChild(input);
        return wrap;
      }

      const grid = document.createElement("div");
      grid.className = "contact-row-grid";
      grid.appendChild(fieldInput("Name", CONFIG.FIELD_NAME, "text", f[CONFIG.FIELD_NAME]));
      grid.appendChild(fieldInput("Email", CONFIG.FIELD_EMAIL, "email", f[CONFIG.FIELD_EMAIL]));
      grid.appendChild(fieldInput("Phone", CONFIG.FIELD_PHONE, "tel", f[CONFIG.FIELD_PHONE]));
      row.appendChild(grid);

      const actions = document.createElement("div");
      actions.className = "contact-row-actions";
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-contact-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", removeHandler);
      actions.appendChild(removeBtn);
      row.appendChild(actions);

      return row;
    }

    function renderSearchLinkBlock(sectionTitle, onLink, linkedIds) {
      const wrap = document.createElement("div");
      wrap.className = "contact-search-block";

      const label = document.createElement("label");
      label.className = "contact-search-label";
      label.textContent = "Search contacts to link";
      wrap.appendChild(label);

      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.className = "contact-search-input";
      searchInput.placeholder = "Search by name, email, or phone…";
      wrap.appendChild(searchInput);

      const results = document.createElement("div");
      results.className = "contact-search-results hidden";
      wrap.appendChild(results);

      let allContactsCache = null;

      async function ensureContacts() {
        if (!allContactsCache) allContactsCache = await fetchAllRecords(CONFIG.TABLE_CONTACTS);
        return allContactsCache;
      }

      function renderResults(query) {
        const q = String(query || "").trim().toLowerCase();
        results.innerHTML = "";
        if (!q) {
          hide(results);
          return;
        }
        Promise.all([ensureContacts(), Promise.resolve(linkedIds())]).then(function (pair) {
          const all = pair[0];
          const linkedRaw = pair[1];
          const linked = new Set(Array.isArray(linkedRaw) ? linkedRaw : []);
          const matches = all.filter(function (c) {
            if (linked.has(c.id)) return false;
            const f = c.fields || {};
            const hay = [
              f[CONFIG.FIELD_NAME],
              f[CONFIG.FIELD_EMAIL],
              f[CONFIG.FIELD_PHONE],
            ].filter(Boolean).join(" ").toLowerCase();
            return hay.indexOf(q) >= 0;
          }).slice(0, 10);

          if (!matches.length) {
            results.textContent = "No matching contacts found.";
            show(results);
            return;
          }

          matches.forEach(function (c) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "contact-search-result";
            btn.textContent = contactLabel(c);
            btn.addEventListener("click", function () {
              onLink(c).then(function () {
                searchInput.value = "";
                hide(results);
              }).catch(function (err) {
                console.error("[Kickoff Contacts] link failed", err);
              });
            });
            results.appendChild(btn);
          });
          show(results);
        });
      }

      searchInput.addEventListener("input", function () {
        renderResults(searchInput.value);
      });

      return wrap;
    }

    function renderCreateContactBlock(onCreate) {
      const wrap = document.createElement("div");
      wrap.className = "contact-create-block";

      const title = document.createElement("div");
      title.className = "contact-create-title";
      title.textContent = "Create new contact";
      wrap.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "contact-create-grid";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Name";
      const emailInput = document.createElement("input");
      emailInput.type = "email";
      emailInput.placeholder = "Email";
      const phoneInput = document.createElement("input");
      phoneInput.type = "tel";
      phoneInput.placeholder = "Phone";

      grid.appendChild(nameInput);
      grid.appendChild(emailInput);
      grid.appendChild(phoneInput);
      wrap.appendChild(grid);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-contact-add";
      btn.textContent = "Create & link";
      btn.addEventListener("click", function () {
        const fields = {};
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();
        if (name) fields[CONFIG.FIELD_NAME] = name;
        if (email) fields[CONFIG.FIELD_EMAIL] = email;
        if (phone) fields[CONFIG.FIELD_PHONE] = phone;
        if (!name && !email && !phone) return;
        btn.disabled = true;
        onCreate(fields).then(function () {
          nameInput.value = "";
          emailInput.value = "";
          phoneInput.value = "";
        }).catch(function (err) {
          console.error("[Kickoff Contacts] create failed", err);
        }).finally(function () {
          btn.disabled = false;
        });
      });
      wrap.appendChild(btn);

      return wrap;
    }

    function show(el) { el.classList.remove("hidden"); }
    function hide(el) { el.classList.add("hidden"); }

    /**
     * @param {HTMLElement} container
     * @param {{ client: object, adsets: object[], nicheLabel: function }} state
     * @param {{ onClientUpdated: function, onAdsetsUpdated: function }} callbacks
     */
    async function renderContactsStep(container, state, callbacks) {
      container.innerHTML = "";
      const client = state.client;
      const adsets = state.adsets || [];
      const nicheLabel = state.nicheLabel || function () { return "Ad set"; };

      const billingSection = document.createElement("section");
      billingSection.className = "contacts-section billing-contacts-section";

      const billingHeading = document.createElement("h3");
      billingHeading.className = "adset-cap-heading";
      billingHeading.textContent = "Billing Contacts";
      billingSection.appendChild(billingHeading);

      const billingSub = document.createElement("p");
      billingSub.className = "field-subtext";
      billingSub.textContent = "Contacts who receive billing updates and receipts.";
      billingSection.appendChild(billingSub);

      const billingList = document.createElement("div");
      billingList.className = "contact-list";
      billingList.dataset.role = "billing-list";
      billingSection.appendChild(billingList);

      async function refreshBillingList() {
        const freshClient = await fetchClient(client.id);
        callbacks.onClientUpdated(freshClient);
        const ids = Array.isArray(freshClient.fields[CONFIG.FIELD_BILLING_CONTACTS])
          ? freshClient.fields[CONFIG.FIELD_BILLING_CONTACTS]
          : [];
        const contacts = await fetchRecordsByIds(CONFIG.TABLE_CONTACTS, ids);
        billingList.innerHTML = "";
        if (!contacts.length) {
          const empty = document.createElement("p");
          empty.className = "field-subtext";
          empty.textContent = "No billing contacts linked.";
          billingList.appendChild(empty);
          return;
        }
        contacts.forEach(function (contact) {
          billingList.appendChild(renderContactRow(contact, async function () {
            const latest = await fetchClient(client.id);
            const current = Array.isArray(latest.fields[CONFIG.FIELD_BILLING_CONTACTS])
              ? latest.fields[CONFIG.FIELD_BILLING_CONTACTS]
              : [];
            const fields = {};
            fields[CONFIG.FIELD_BILLING_CONTACTS] = current.filter(function (id) {
              return id !== contact.id;
            });
            const updated = await patchClient(client.id, fields);
            callbacks.onClientUpdated(updated);
            await refreshBillingList();
          }));
        });
      }

      billingSection.appendChild(renderSearchLinkBlock("Billing", async function (contact) {
        const latest = await fetchClient(client.id);
        const current = Array.isArray(latest.fields[CONFIG.FIELD_BILLING_CONTACTS])
          ? latest.fields[CONFIG.FIELD_BILLING_CONTACTS]
          : [];
        const fields = {};
        fields[CONFIG.FIELD_BILLING_CONTACTS] = mergeUniqueIds(current, [contact.id]);
        const updated = await patchClient(client.id, fields);
        callbacks.onClientUpdated(updated);
        await refreshBillingList();
      }, async function () {
        const latest = await fetchClient(client.id);
        return Array.isArray(latest.fields[CONFIG.FIELD_BILLING_CONTACTS])
          ? latest.fields[CONFIG.FIELD_BILLING_CONTACTS]
          : [];
      }));

      billingSection.appendChild(renderCreateContactBlock(async function (fields) {
        const created = await createContact(fields);
        if (!created) return;
        const latest = await fetchClient(client.id);
        const current = Array.isArray(latest.fields[CONFIG.FIELD_BILLING_CONTACTS])
          ? latest.fields[CONFIG.FIELD_BILLING_CONTACTS]
          : [];
        const patchFields = {};
        patchFields[CONFIG.FIELD_BILLING_CONTACTS] = mergeUniqueIds(current, [created.id]);
        const updated = await patchClient(client.id, patchFields);
        callbacks.onClientUpdated(updated);
        await refreshBillingList();
      }));

      container.appendChild(billingSection);
      await refreshBillingList();

      for (let i = 0; i < adsets.length; i++) {
        const adset = adsets[i];
        const section = document.createElement("section");
        section.className = "contacts-section lead-contacts-section";
        section.dataset.adsetId = adset.id;

        const heading = document.createElement("h3");
        heading.className = "adset-cap-heading";
        heading.textContent = nicheLabel(adset) + " — New Leads";
        section.appendChild(heading);

        const sub = document.createElement("p");
        sub.className = "field-subtext";
        sub.textContent = "Contacts notified when a new lead comes in for this ad set.";
        section.appendChild(sub);

        const list = document.createElement("div");
        list.className = "contact-list";
        list.dataset.role = "lead-list";
        section.appendChild(list);

        async function refreshLeadList() {
          const freshAdset = await fetchAdset(adset.id);
          const nextAdsets = adsets.map(function (a) {
            return a.id === adset.id
              ? { id: freshAdset.id, fields: freshAdset.fields || {} }
              : a;
          });
          callbacks.onAdsetsUpdated(nextAdsets);

          const ids = Array.isArray(freshAdset.fields[CONFIG.FIELD_LEAD_CONTACTS])
            ? freshAdset.fields[CONFIG.FIELD_LEAD_CONTACTS]
            : [];
          const contacts = await fetchRecordsByIds(CONFIG.TABLE_CONTACTS, ids);
          list.innerHTML = "";
          if (!contacts.length) {
            const empty = document.createElement("p");
            empty.className = "field-subtext";
            empty.textContent = "No new-lead contacts linked.";
            list.appendChild(empty);
            return;
          }
          contacts.forEach(function (contact) {
            list.appendChild(renderContactRow(contact, async function () {
              const latest = await fetchAdset(adset.id);
              const current = Array.isArray(latest.fields[CONFIG.FIELD_LEAD_CONTACTS])
                ? latest.fields[CONFIG.FIELD_LEAD_CONTACTS]
                : [];
              const fields = {};
              fields[CONFIG.FIELD_LEAD_CONTACTS] = current.filter(function (id) {
                return id !== contact.id;
              });
              const updated = await patchAdset(adset.id, fields);
              const next = adsets.map(function (a) {
                return a.id === adset.id
                  ? { id: updated.id, fields: updated.fields || {} }
                  : a;
              });
              callbacks.onAdsetsUpdated(next);
              await refreshLeadList();
            }));
          });
        }

        section.appendChild(renderSearchLinkBlock("Lead", async function (contact) {
          await addContactToAdsetLeadContacts(adset.id, contact.id);
          await refreshLeadList();
        }, async function () {
          const fresh = await fetchAdset(adset.id);
          return Array.isArray(fresh.fields[CONFIG.FIELD_LEAD_CONTACTS])
            ? fresh.fields[CONFIG.FIELD_LEAD_CONTACTS]
            : [];
        }));

        section.appendChild(renderCreateContactBlock(async function (fields) {
          const created = await createContact(fields);
          if (!created) return;
          await addContactToAdsetLeadContacts(adset.id, created.id);
          await refreshLeadList();
        }));

        container.appendChild(section);
        await refreshLeadList();
      }
    }

    return {
      migrateBillingContacts: migrateBillingContacts,
      renderContactsStep: renderContactsStep,
    };
  }

  global.KickoffContacts = { create: create };
})(window);
