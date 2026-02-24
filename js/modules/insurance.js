/* Insurance module logic extracted from index.html */
function appendInsuranceChatMessage(role, text) {
    const chatBox = document.getElementById('chatMessages');
    if (!chatBox) return;

    const msg = document.createElement('div');
    msg.className = role === 'user' ? 'user-message' : 'ai-message';
    msg.innerText = String(text || '');
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
}

let insuranceStateDataCache = null;

function parseNumericValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value ?? '')
        .replace(/,/g, '')
        .replace(/[^0-9.-]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
}

function safeLower(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeToken(value) {
    return safeLower(value).replace(/[^a-z0-9]/g, '');
}

function formatIndianNumber(value) {
    return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

async function getInsuranceStateData() {
    if (Array.isArray(insuranceStateDataCache)) return insuranceStateDataCache;

    if (!window.db || !window.collection || !window.getDocs) {
        throw new Error('Database is not initialized yet.');
    }

    const snapshot = await window.getDocs(window.collection(window.db, 'state_lob_data'));
    const records = [];
    snapshot.forEach(docSnap => {
        records.push(docSnap.data() || {});
    });

    insuranceStateDataCache = records;
    return records;
}

function buildStateFiguresReply(userQuery, records) {
    const queryText = safeLower(userQuery);
    const queryToken = normalizeToken(userQuery);
    const yearMatch = queryText.match(/\b(19|20)\d{2}\b/);
    const queryYear = yearMatch ? yearMatch[0] : '';

    const keywordList = ['aviation', 'motor', 'health', 'fire', 'marine', 'crop', 'liability', 'travel', 'engineering'];
    const keyword = keywordList.find(word => queryText.includes(word)) || '';

    const uniqueStates = Array.from(new Set(
        records
            .map(item => String(item.state_name || item.state || '').trim())
            .filter(Boolean)
    ));

    const matchedStates = uniqueStates.filter(stateName => {
        const stateLower = safeLower(stateName);
        const stateToken = normalizeToken(stateName);
        return queryText.includes(stateLower) || (stateToken && queryToken.includes(stateToken));
    });

    const compareIntent = /\b(compare|vs|versus)\b/.test(queryText);

    const filterRows = (stateName = '') => records.filter(item => {
        const rowState = String(item.state_name || item.state || '').trim();
        const rowStateLower = safeLower(rowState);
        if (stateName && rowStateLower !== safeLower(stateName)) return false;

        if (queryYear && String(item.year || '').trim() !== queryYear) return false;

        if (keyword) {
            const lob = safeLower(item.lob || '');
            const segment = safeLower(item.segment || '');
            if (!lob.includes(keyword) && !segment.includes(keyword)) return false;
        }

        return true;
    });

    const summarize = rows => {
        const total = rows.reduce((sum, item) => sum + parseNumericValue(item.value), 0);
        const byLob = new Map();
        rows.forEach(item => {
            const lob = String(item.lob || item.segment || 'Unknown').trim() || 'Unknown';
            byLob.set(lob, (byLob.get(lob) || 0) + parseNumericValue(item.value));
        });

        const topLobs = Array.from(byLob.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([lob, value]) => `${lob}: ${formatIndianNumber(value)}`);

        return {
            count: rows.length,
            total,
            topLobs
        };
    };

    if (compareIntent && matchedStates.length >= 2) {
        const leftState = matchedStates[0];
        const rightState = matchedStates[1];

        const leftRows = filterRows(leftState);
        const rightRows = filterRows(rightState);

        if (!leftRows.length && !rightRows.length) {
            return 'No matching records found for comparison. Try: Compare Karnataka and Andhra Pradesh in marine 2024.';
        }

        const left = summarize(leftRows);
        const right = summarize(rightRows);
        const diff = left.total - right.total;
        const winner = diff === 0 ? 'Both are equal' : diff > 0 ? leftState : rightState;
        const scope = `${queryYear || 'all years'}${keyword ? `, ${keyword}` : ''}`;

        return [
            `Comparison (${scope}): ${leftState} vs ${rightState}`,
            `${leftState} — Total: ${formatIndianNumber(left.total)} | Records: ${left.count} | Top: ${left.topLobs.join(' | ') || 'n/a'}`,
            `${rightState} — Total: ${formatIndianNumber(right.total)} | Records: ${right.count} | Top: ${right.topLobs.join(' | ') || 'n/a'}`,
            `${winner}${diff !== 0 ? ` leads by ${formatIndianNumber(Math.abs(diff))}` : ''}.`
        ].join('\n');
    }

    const selectedState = matchedStates[0] || '';
    const filtered = filterRows(selectedState);

    if (!filtered.length) {
        return 'No matching records found in state_lob_data. Try a query like: Karnataka aviation 2025, or Compare Karnataka and Andhra Pradesh marine 2024.';
    }

    const summary = summarize(filtered);
    const scopeState = selectedState || 'All states';
    const scopeYear = queryYear || 'all years';
    const scopeKeyword = keyword ? `, ${keyword}` : '';

    return [
        `${scopeState} (${scopeYear}${scopeKeyword})`,
        `Total value: ${formatIndianNumber(summary.total)} | Records: ${summary.count}`,
        `Top lines: ${summary.topLobs.join(' | ') || 'n/a'}`
    ].join('\n');
}

async function fetchInsuranceDatabaseReply(userQuery) {
    const records = await getInsuranceStateData();
    return buildStateFiguresReply(userQuery, records);
}

window.askInsuranceAssistant = async function(query) {
    console.log("AI called with:", query);

    const message = String(query || '').trim();
    if (!message) return;

    appendInsuranceChatMessage('user', message);

    const inputEl = document.getElementById('insuranceInput');
    if (inputEl) inputEl.value = '';

    if (typeof window.askInsuranceAI === 'function') {
        try {
            const result = await window.askInsuranceAI(message);
            if (typeof result === 'string' && result.trim()) {
                appendInsuranceChatMessage('ai', result.trim());
            }
            return;
        } catch (error) {
            console.error(error);
            appendInsuranceChatMessage('ai', 'Error fetching insurance intelligence.');
            return;
        }
    }

    try {
        const dbReply = await fetchInsuranceDatabaseReply(message);
        appendInsuranceChatMessage('ai', dbReply);
    } catch (error) {
        console.error(error);
        appendInsuranceChatMessage('ai', 'Insurance AI is not ready yet and database lookup failed.');
    }
};

function bindInsuranceSendHandler() {
    const sendBtn = document.getElementById('insuranceSendBtn');
    const inputEl = document.getElementById('insuranceInput');
    if (!sendBtn || !inputEl) return;

    if (sendBtn.dataset.boundInsuranceSend === 'true') return;
    sendBtn.dataset.boundInsuranceSend = 'true';

    sendBtn.addEventListener('click', () => {
        console.log('Send clicked');

        const input = document.getElementById('insuranceInput').value;
        console.log('User input:', input);

        if (window.askInsuranceAssistant) {
            window.askInsuranceAssistant(input);
        }
    });

    inputEl.addEventListener('keypress', event => {
        if (event.key === 'Enter') {
            sendBtn.click();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindInsuranceSendHandler);
} else {
    bindInsuranceSendHandler();
}

function normalizeInsuranceActName(value) {
    const text = String(value || '').trim();
    const cleaned = text
        .replace(/^['"`]+/, '')
        .replace(/^(?:ðŸ[\u0080-\u00BF]{0,4}|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â[\u0080-\u00BF]{1,2})+/g, '')
        .trim();

    return cleaned || 'Insurance Act';
}

window.firebaseGetInsuranceActs = async function() {
    if (!currentUserId) return [];

    const snapshot = await getDocs(query(
        collection(db, 'acts'),
        where('userId', '==', currentUserId)
    ));

    const acts = [];
    snapshot.forEach(docSnap => {
        const data = docSnap.data() || {};
        acts.push({
            actId: docSnap.id,
            actName: normalizeInsuranceActName(data.actName || data.title || ''),
            year: data.year || '',
            description: data.description || '',
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0
        });
    });

    acts.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return acts;
};

window.firebaseGetInsuranceProvisions = async function() {
    if (!currentUserId) return [];

    const snapshot = await getDocs(query(
        collection(db, 'provisions'),
        where('userId', '==', currentUserId)
    ));

    const provisions = [];
    snapshot.forEach(docSnap => {
        const data = docSnap.data() || {};
        provisions.push({
            provisionId: docSnap.id,
            actId: data.actId || '',
            sectionNumber: data.sectionNumber || '',
            sectionTitle: data.sectionTitle || '',
            sectionText: data.sectionText || '',
            plainExplanation: data.plainExplanation || '',
            purposeOfSection: data.purposeOfSection || '',
            tags: Array.isArray(data.tags) ? data.tags : [],
            relatedSections: Array.isArray(data.relatedSections) ? data.relatedSections : [],
            supervisoryFocusAreas: data.supervisoryFocusAreas || '',
            practicalExamples: data.practicalExamples || '',
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0
        });
    });

    provisions.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return provisions;
};

window.firebaseLoadInsuranceActsAndProvisions = async function() {
    if (!currentUserId) {
        insuranceActs = [];
        insuranceProvisions = [];
        return;
    }

    const [acts, provisions] = await Promise.all([
        window.firebaseGetInsuranceActs(),
        window.firebaseGetInsuranceProvisions()
    ]);

    insuranceActs = acts;
    insuranceProvisions = provisions.filter(item => insuranceActs.some(act => act.actId === item.actId));

    if (insuranceActiveActId && !insuranceActs.some(act => act.actId === insuranceActiveActId)) {
        insuranceActiveActId = null;
    }

    if (insuranceProvisionEditId && !insuranceProvisions.some(item => item.provisionId === insuranceProvisionEditId)) {
        insuranceProvisionEditId = null;
    }
};

window.firebaseCreateInsuranceAct = async function(data) {
    if (!currentUserId) {
        alert('Not logged in');
        return;
    }

    await addDoc(collection(db, 'acts'), {
        userId: currentUserId,
        module: 'Insurance',
        actName: normalizeInsuranceActName(data.actName || ''),
        year: data.year || '',
        description: data.description || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
};

window.firebaseUpdateInsuranceAct = async function(actId, data) {
    const refDoc = doc(db, 'acts', actId);
    const docSnap = await getDoc(refDoc);
    if (!docSnap.exists()) throw new Error('Act not found');

    const existing = docSnap.data() || {};
    if (existing.userId !== currentUserId) {
        throw new Error('You do not have permission to edit this act');
    }

    await updateDoc(refDoc, {
        actName: normalizeInsuranceActName(data.actName || ''),
        year: data.year || '',
        description: data.description || '',
        updatedAt: Date.now()
    });
};

window.firebaseDeleteInsuranceActAndProvisions = async function(actId) {
    const refAct = doc(db, 'acts', actId);
    const actSnap = await getDoc(refAct);
    if (!actSnap.exists()) throw new Error('Act not found');

    const existingAct = actSnap.data() || {};
    if (existingAct.userId !== currentUserId) {
        throw new Error('You do not have permission to delete this act');
    }

    const provisionsSnapshot = await getDocs(query(
        collection(db, 'provisions'),
        where('userId', '==', currentUserId)
    ));

    const deletePromises = [];
    provisionsSnapshot.forEach(docSnap => {
        const data = docSnap.data() || {};
        if (data.actId === actId) {
            deletePromises.push(deleteDoc(doc(db, 'provisions', docSnap.id)));
        }
    });

    await Promise.all(deletePromises);
    await deleteDoc(refAct);
};

window.firebaseCreateInsuranceProvision = async function(data) {
    if (!currentUserId) return;
    await addDoc(collection(db, 'provisions'), {
        userId: currentUserId,
        module: 'Insurance',
        actId: data.actId || '',
        sectionNumber: data.sectionNumber || '',
        sectionTitle: data.sectionTitle || '',
        sectionText: data.sectionText || '',
        plainExplanation: data.plainExplanation || '',
        purposeOfSection: data.purposeOfSection || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        relatedSections: Array.isArray(data.relatedSections) ? data.relatedSections : [],
        supervisoryFocusAreas: data.supervisoryFocusAreas || '',
        practicalExamples: data.practicalExamples || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
};

window.firebaseUpdateInsuranceProvision = async function(provisionId, data) {
    const refDoc = doc(db, 'provisions', provisionId);
    const docSnap = await getDoc(refDoc);
    if (!docSnap.exists()) throw new Error('Provision not found');

    const existing = docSnap.data() || {};
    if (existing.userId !== currentUserId) {
        throw new Error('You do not have permission to edit this provision');
    }

    await updateDoc(refDoc, {
        actId: data.actId || '',
        sectionNumber: data.sectionNumber || '',
        sectionTitle: data.sectionTitle || '',
        sectionText: data.sectionText || '',
        plainExplanation: data.plainExplanation || '',
        purposeOfSection: data.purposeOfSection || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        relatedSections: Array.isArray(data.relatedSections) ? data.relatedSections : [],
        supervisoryFocusAreas: data.supervisoryFocusAreas || '',
        practicalExamples: data.practicalExamples || '',
        updatedAt: Date.now()
    });
};

window.firebaseDeleteInsuranceProvision = async function(provisionId) {
    const refDoc = doc(db, 'provisions', provisionId);
    const docSnap = await getDoc(refDoc);
    if (!docSnap.exists()) throw new Error('Provision not found');

    const existing = docSnap.data() || {};
    if (existing.userId !== currentUserId) {
        throw new Error('You do not have permission to delete this provision');
    }

    await deleteDoc(refDoc);
};
