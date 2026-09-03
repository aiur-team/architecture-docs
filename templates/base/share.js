startSharePanel();

function startSharePanel() {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  document.addEventListener("session", mountSharePanel, { once: true });
}

function mountSharePanel(event) {
  const session = event.detail;
  if (!validSession(session)) return;

  const host = document.querySelector(".head-top");
  if (!(host instanceof HTMLElement)
    || host.ownerDocument !== document
    || !host.isConnected) return;
  for (const child of host.children) {
    if (child.id === "doc-share-button" || child.classList.contains("share-btn")) return;
  }

  let docId = session.doc;
  let sessionRole = session.role;
  let mayShare = session.canShare;
  let panel = null;
  let heading = null;
  let closeButton = null;
  let status = null;
  let defaultPolicy = null;
  let memberList = null;
  let invitationSection = null;
  let invitationList = null;
  let invoker = null;
  let controller = null;
  let generation = 0;
  let positionFrame = 0;
  let removed = false;

  const button = document.createElement("button");
  button.id = "doc-share-button";
  button.className = "tt share-btn";
  button.setAttribute("type", "button");
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "doc-share-panel");
  button.appendChild(document.createTextNode("Share"));
  button.addEventListener("click", togglePanel);
  host.appendChild(button);

  function validSession(value) {
    if (!isRecord(value) || !/^[0-9a-f]{6}$/.test(value.doc)) return false;
    if (value.shared !== true || value.canSeeMembers !== true) return false;
    return (value.role === "owner" && value.canShare === true)
      || (value.role === "editor" && value.canShare === false);
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function fixedElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className !== "") element.className = className;
    if (text !== null) element.appendChild(document.createTextNode(text));
    return element;
  }

  function createPanel() {
    panel = fixedElement("aside", "share-pop", null);
    panel.id = "doc-share-panel";
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "doc-share-title");

    const panelHeader = fixedElement("header", "share-head", null);
    heading = fixedElement("h2", "", "Access");
    heading.id = "doc-share-title";
    heading.setAttribute("tabindex", "-1");
    closeButton = fixedElement("button", "share-close", "Close access panel");
    closeButton.setAttribute("type", "button");
    panelHeader.append(heading, closeButton);

    status = fixedElement("p", "share-status", null);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    defaultPolicy = fixedElement("p", "share-default", null);

    const memberSection = fixedElement("section", "share-members", null);
    memberSection.setAttribute("aria-labelledby", "doc-share-members-title");
    const memberTitle = fixedElement("h3", "", "People with access");
    memberTitle.id = "doc-share-members-title";
    memberList = fixedElement("ul", "share-list", null);
    memberSection.append(memberTitle, memberList);

    invitationSection = fixedElement("section", "share-invitations", null);
    invitationSection.setAttribute("aria-labelledby", "doc-share-invitations-title");
    const invitationTitle = fixedElement("h3", "", "Pending invitations");
    invitationTitle.id = "doc-share-invitations-title";
    invitationList = fixedElement("ul", "share-list", null);
    invitationSection.append(invitationTitle, invitationList);

    panel.append(panelHeader, status, defaultPolicy, memberSection, invitationSection);
    document.body.appendChild(panel);
    closeButton.addEventListener("click", closePanel);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("pointerdown", handlePointerdown);
    window.addEventListener("resize", handlePositionChange);
    window.addEventListener("scroll", handlePositionChange, true);
  }

  function togglePanel() {
    if (removed) return;
    if (panel === null) createPanel();
    if (!panel.hidden) {
      closePanel();
      return;
    }
    openPanel();
  }

  function openPanel() {
    invoker = button;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    status.textContent = "Loading access…";
    if (!positionPanel()) return;
    heading.focus();
    refreshRoster();
  }

  function closePanel() {
    if (panel === null || panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    generation += 1;
    if (controller !== null) {
      const closingController = controller;
      controller = null;
      closingController.abort();
    }
    if (positionFrame !== 0) {
      cancelAnimationFrame(positionFrame);
      positionFrame = 0;
    }
    if (invoker !== null && invoker.isConnected) invoker.focus();
  }

  function handleKeydown(event) {
    if (panel !== null && !panel.hidden && event.key === "Escape") {
      event.preventDefault();
      closePanel();
    }
  }

  function handlePointerdown(event) {
    if (panel === null || panel.hidden || event.button !== 0) return;
    if (!panel.contains(event.target) && !button.contains(event.target)) closePanel();
  }

  function handlePositionChange() {
    if (panel === null || panel.hidden || positionFrame !== 0) return;
    positionFrame = -1;
    const requestedFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      positionPanel();
    });
    if (positionFrame === -1) positionFrame = requestedFrame;
  }

  function positionPanel() {
    const rect = button.getBoundingClientRect();
    const values = [
      window.scrollX, window.scrollY, window.innerHeight,
      panel.offsetWidth, panel.offsetHeight,
      rect.top, rect.bottom, rect.right,
      document.documentElement.clientWidth,
    ];
    if (!values.every(Number.isFinite)) {
      closePanel();
      return false;
    }

    const lowerTop = window.scrollY + 8;
    const upperTop = window.scrollY + window.innerHeight - panel.offsetHeight - 8;
    const below = window.scrollY + rect.bottom + 8;
    const above = window.scrollY + rect.top - panel.offsetHeight - 8;
    let top;
    if (upperTop < lowerTop) top = lowerTop;
    else if (below <= upperTop) top = below;
    else top = Math.min(upperTop, Math.max(lowerTop, above));

    const lowerLeft = window.scrollX + 8;
    const upperLeft = window.scrollX + document.documentElement.clientWidth
      - panel.offsetWidth - 8;
    const desiredLeft = window.scrollX + rect.right - panel.offsetWidth;
    const left = upperLeft < lowerLeft
      ? lowerLeft
      : Math.min(upperLeft, Math.max(lowerLeft, desiredLeft));
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
    return true;
  }

  async function refreshRoster() {
    const requestGeneration = generation + 1;
    generation = requestGeneration;
    const requestController = new AbortController();
    controller = requestController;
    const endpoint = new URL("/api/access", location.href);
    endpoint.searchParams.set("doc", docId);
    const deadline = setTimeout(() => requestController.abort(), 5_000);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        mode: "same-origin",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: requestController.signal,
      });
      if (!isCurrent(requestGeneration)) return;
      if (response.status === 401 || response.status === 403) {
        removeFeature();
        return;
      }
      if (response.status !== 200) throw new Error();
      const contentType = response.headers.get("Content-Type");
      if (typeof contentType !== "string"
        || !/^[\t ]*(?:application\/json|application\/json; charset=utf-8)[\t ]*$/i.test(contentType)) {
        throw new Error();
      }
      const contentLength = response.headers.get("Content-Length");
      if (contentLength !== null) {
        if (!/^(?:0|[1-9][0-9]{0,4})$/.test(contentLength)) throw new Error();
        const length = Number(contentLength);
        if (!Number.isSafeInteger(length) || length > 65_536) throw new Error();
      }
      const responseBody = response.body;
      if (responseBody === null) throw new Error();
      const reader = responseBody.getReader();
      let complete = false;
      const chunks = [];
      let byteCount = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done === true) {
            complete = true;
            break;
          }
          if (!(result.value instanceof Uint8Array)) throw new Error();
          const nextCount = byteCount + result.value.byteLength;
          if (!Number.isSafeInteger(nextCount) || nextCount > 65_536) throw new Error();
          byteCount = nextCount;
          chunks.push(result.value);
        }
      } finally {
        if (!complete) {
          try {
            await reader.cancel();
          } catch (error) {
            // Cancellation is best-effort; the fixed refresh failure is retained.
          }
        }
        reader.releaseLock();
      }
      if (!isCurrent(requestGeneration)) return;
      const bytes = new Uint8Array(byteCount);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const roster = JSON.parse(decoded);
      if (!validRoster(roster)) throw new Error();
      if (!isCurrent(requestGeneration)) return;
      renderRoster(roster);
    } catch (error) {
      if (isCurrent(requestGeneration)) status.textContent = "Access list could not be refreshed.";
    } finally {
      clearTimeout(deadline);
      if (generation === requestGeneration && controller === requestController) controller = null;
    }
  }

  function isCurrent(requestGeneration) {
    return !removed && generation === requestGeneration && panel !== null && !panel.hidden;
  }

  function validRoster(value) {
    if (!exactRecord(value, ["doc", "orgDefault", "members", "invitations"])) return false;
    if (value.doc !== docId || !["commenter", "viewer", "none"].includes(value.orgDefault)) return false;
    if (!Array.isArray(value.members) || value.members.length < 1 || value.members.length > 51) return false;
    if (!Array.isArray(value.invitations) || value.invitations.length > 50) return false;
    if ((value.members.length - 1) + value.invitations.length > 50) return false;

    const subjects = new Set();
    const memberEmails = new Set();
    let previousMember = null;
    for (let index = 0; index < value.members.length; index += 1) {
      const member = value.members[index];
      if (!exactRecord(member, ["sub", "email", "name", "role"])) return false;
      if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(member.sub)) return false;
      if (!validEmail(member.email) || typeof member.name !== "string" || member.name.length > 200) return false;
      if (subjects.has(member.sub) || memberEmails.has(member.email)) return false;
      subjects.add(member.sub);
      memberEmails.add(member.email);
      if (index === 0) {
        if (member.role !== "owner" || member.name !== "") return false;
      } else {
        if (!["editor", "commenter", "viewer"].includes(member.role)) return false;
        if (previousMember !== null
          && (member.email < previousMember.email
            || (member.email === previousMember.email && member.sub <= previousMember.sub))) return false;
        previousMember = member;
      }
    }

    const invitationEmails = new Set();
    let previousEmail = null;
    for (const invitation of value.invitations) {
      if (!exactRecord(invitation, ["email", "role", "expiresAt"])) return false;
      if (!validEmail(invitation.email)
        || !["editor", "commenter", "viewer"].includes(invitation.role)
        || typeof invitation.expiresAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(invitation.expiresAt)) return false;
      if (invitationEmails.has(invitation.email)
        || (previousEmail !== null && invitation.email <= previousEmail)) return false;
      const expires = new Date(invitation.expiresAt);
      if (!Number.isFinite(expires.getTime()) || expires.toISOString() !== invitation.expiresAt) return false;
      invitationEmails.add(invitation.email);
      previousEmail = invitation.email;
    }
    return true;
  }

  function exactRecord(value, keys) {
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const actual = Object.keys(value);
    return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
  }

  function validEmail(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 254) return false;
    if (value !== value.toLowerCase() || /[\x00-\x20\x7f,/:\\]/.test(value)) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (value.charCodeAt(index) > 127) return false;
    }
    const at = value.indexOf("@");
    return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1;
  }

  function roleLabel(role) {
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  function renderRoster(roster) {
    const memberRows = roster.members.map((member) => {
      const row = document.createElement("li");
      const prefix = member.name === "" ? "" : `${member.name} — `;
      row.appendChild(document.createTextNode(`${prefix}${member.email} — ${roleLabel(member.role)}`));
      return row;
    });
    const invitationRows = roster.invitations.map((invitation) => {
      const row = document.createElement("li");
      row.appendChild(document.createTextNode(`${invitation.email} — ${roleLabel(invitation.role)} — Pending until `));
      const date = document.createElement("time");
      date.setAttribute("datetime", invitation.expiresAt);
      date.appendChild(document.createTextNode(invitation.expiresAt.slice(0, 10)));
      row.appendChild(date);
      return row;
    });
    const defaultLabels = { commenter: "Commenter", viewer: "Viewer", none: "No access" };
    memberList.replaceChildren(...memberRows);
    invitationList.replaceChildren(...invitationRows);
    defaultPolicy.textContent = `Organization default: ${defaultLabels[roster.orgDefault]}`;
    invitationSection.hidden = invitationRows.length === 0;
    status.textContent = "";
    handlePositionChange();
  }

  function removeFeature() {
    if (removed) return;
    removed = true;
    generation += 1;
    if (positionFrame !== 0) {
      cancelAnimationFrame(positionFrame);
      positionFrame = 0;
    }
    if (invoker !== null && invoker.isConnected) invoker.focus();
    button.removeEventListener("click", togglePanel);
    if (closeButton !== null) closeButton.removeEventListener("click", closePanel);
    document.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("pointerdown", handlePointerdown);
    window.removeEventListener("resize", handlePositionChange);
    window.removeEventListener("scroll", handlePositionChange, true);
    if (memberList !== null) memberList.replaceChildren();
    if (invitationList !== null) invitationList.replaceChildren();
    if (defaultPolicy !== null) defaultPolicy.textContent = "";
    button.remove();
    if (panel !== null) panel.remove();
    if (controller !== null) {
      const removingController = controller;
      controller = null;
      removingController.abort();
    }
    docId = "";
    sessionRole = "";
    mayShare = false;
    invoker = null;
  }
}
