const MS_DAY = 86400000;
const fs = require('fs');
const path = require('path');

function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function makeClock(todayISOValue) {
  return {
    todayISO() {
      return todayISOValue;
    },
  };
}

function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function parseISODateLocal(value) {
  if (!isValidISODate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function monthlyAnchorDay(item, dateKey) {
  const anchorISO = isValidISODate(item.startDate) ? item.startDate : item[dateKey];
  const anchor = parseISODateLocal(anchorISO);
  return anchor ? anchor.getDate() : null;
}

function addMonthsClamped(date, months, anchorDay) {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const wantedDay = anchorDay || date.getDate();
  next.setDate(Math.min(wantedDay, daysInMonth(next.getFullYear(), next.getMonth())));
  return next;
}

function currentAdvanceRecurringDate(dateISO, cycle, anchorDay = null) {
  const d = parseISODateLocal(dateISO);
  if (!d) return null;
  if (cycle === 'weekly') d.setDate(d.getDate() + 7);
  else if (cycle === 'fortnightly') d.setDate(d.getDate() + 14);
  else if (cycle === 'monthly') {
    const day = anchorDay || d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  } else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else return null;
  return isoOf(d);
}

function currentComputeNextPayDate(src, todayISOValue) {
  if (!src.nextPay || src.cycle === 'irregular') return null;
  const today = parseISODateLocal(todayISOValue);
  let next = parseISODateLocal(src.nextPay);
  if (!next) return null;
  if (next >= today) return src.nextPay;

  const anchorDay = src.cycle === 'monthly' ? monthlyAnchorDay(src, 'nextPay') : null;
  if (src.cycle === 'weekly') {
    while (next < today) next.setDate(next.getDate() + 7);
  } else if (src.cycle === 'fortnightly') {
    while (next < today) next.setDate(next.getDate() + 14);
  } else if (src.cycle === 'monthly') {
    while (next < today) {
      next = addMonthsClamped(next, 1, anchorDay);
    }
  } else return null;
  return isoOf(next);
}

function currentComputeNextDueDate(rec, todayISOValue) {
  if (!rec.nextDue) return null;
  const today = parseISODateLocal(todayISOValue);
  let next = parseISODateLocal(rec.nextDue);
  if (!next) return null;
  if (next >= today) return rec.nextDue;

  const anchorDay = rec.cycle === 'monthly' ? monthlyAnchorDay(rec, 'nextDue') : null;
  while (next < today) {
    if (rec.cycle === 'weekly') next.setDate(next.getDate() + 7);
    else if (rec.cycle === 'fortnightly') next.setDate(next.getDate() + 14);
    else if (rec.cycle === 'monthly') {
      next = addMonthsClamped(next, 1, anchorDay);
    } else if (rec.cycle === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else break;
  }
  return isoOf(next);
}

function currentRunAutoLog(state, todayISOValue) {
  const today = todayISOValue;
  const todayDate = new Date(today + 'T00:00:00');
  const created = [];
  let advancedAny = false;

  state.incomeSources.forEach((src) => {
    if (!src.autoLog || src.cycle === 'irregular' || !src.nextPay) return;
    if (!isValidISODate(src.nextPay)) return;
    let checkDate = src.nextPay;
    let latestLoggedDate = null;
    const anchorDay = src.cycle === 'monthly' ? monthlyAnchorDay(src, 'nextPay') : null;
    let iterations = 0;
    while (checkDate && checkDate <= today && iterations < 100) {
      const cd = parseISODateLocal(checkDate);
      if (cd <= todayDate) {
        const dupId = 'auto_inc_' + src.id + '_' + checkDate;
        const exists = state.transactions.some((t) => t.autoLogId === dupId);
        if (!exists) {
          state.transactions.push({
            id: 'tx_' + (state.transactions.length + 1),
            type: 'income',
            amount: src.amount,
            description: src.name,
            category: 'salary',
            date: checkDate,
            note: src.note || '',
            autoLogged: true,
            autoLogId: dupId,
            createdAt: 1,
          });
          created.push({ name: src.name, amount: src.amount, type: 'income', date: checkDate });
        }
        latestLoggedDate = checkDate;
      }
      checkDate = currentAdvanceRecurringDate(checkDate, src.cycle, anchorDay);
      iterations++;
    }
    if (checkDate && checkDate <= today) {
      checkDate = currentComputeNextPayDate({ ...src, nextPay: checkDate }, todayISOValue) || checkDate;
      while (checkDate && checkDate <= today) {
        checkDate = currentAdvanceRecurringDate(checkDate, src.cycle, anchorDay);
      }
    }
    if (latestLoggedDate || (checkDate && checkDate !== src.nextPay)) {
      src.lastAutoLogDate = latestLoggedDate;
      src.nextPay = checkDate;
      advancedAny = true;
    }
  });

  state.recurringExpenses.forEach((rec) => {
    if (!rec.active || !rec.nextDue) return;
    if (!isValidISODate(rec.nextDue)) return;
    let checkDate = rec.nextDue;
    let latestLoggedDate = null;
    const anchorDay = rec.cycle === 'monthly' ? monthlyAnchorDay(rec, 'nextDue') : null;
    let iterations = 0;
    while (checkDate && checkDate <= today && iterations < 100) {
      const cd = parseISODateLocal(checkDate);
      if (cd <= todayDate) {
        const dupId = 'auto_exp_' + rec.id + '_' + checkDate;
        const exists = state.transactions.some((t) => t.autoLogId === dupId);
        if (!exists) {
          state.transactions.push({
            id: 'tx_' + (state.transactions.length + 1),
            type: 'expense',
            amount: rec.amount,
            description: rec.name,
            category: rec.category,
            date: checkDate,
            note: rec.note || '',
            autoLogged: true,
            autoLogId: dupId,
            createdAt: 1,
          });
          created.push({ name: rec.name, amount: rec.amount, type: 'expense', date: checkDate });
        }
        latestLoggedDate = checkDate;
      }
      checkDate = currentAdvanceRecurringDate(checkDate, rec.cycle, anchorDay);
      iterations++;
    }
    if (checkDate && checkDate <= today) {
      checkDate = currentComputeNextDueDate({ ...rec, nextDue: checkDate }, todayISOValue) || checkDate;
      while (checkDate && checkDate <= today) {
        checkDate = currentAdvanceRecurringDate(checkDate, rec.cycle, anchorDay);
      }
    }
    if (latestLoggedDate || (checkDate && checkDate !== rec.nextDue)) {
      rec.lastAutoLogDate = latestLoggedDate;
      rec.nextDue = checkDate;
      advancedAny = true;
    }
  });

  return { created, advancedAny };
}

function currentRefreshAutoLogSourceState(state, autoLogId, todayISOValue, deletedDate) {
  if (!autoLogId) return;

  const incMatch = autoLogId.match(/^auto_inc_(.+)_\d{4}-\d{2}-\d{2}$/);
  if (incMatch) {
    const src = state.incomeSources.find((s) => s.id === incMatch[1]);
    if (!src) return;
    const dates = state.transactions
      .filter((t) => t.autoLogId && t.autoLogId.startsWith('auto_inc_' + src.id + '_'))
      .map((t) => t.date)
      .sort();
    const latest = dates[dates.length - 1] || null;
    src.lastAutoLogDate = latest;
    if (latest && src.cycle !== 'irregular') {
      const anchorDay = src.cycle === 'monthly' ? monthlyAnchorDay(src, 'nextPay') : null;
      src.nextPay = currentComputeNextPayDate({ ...src, nextPay: currentAdvanceRecurringDate(latest, src.cycle, anchorDay) }, todayISOValue);
    } else if (deletedDate) {
      src.nextPay = deletedDate;
    } else if (src.nextPay) {
      src.nextPay = currentComputeNextPayDate(src, todayISOValue) || src.nextPay;
    }
    return;
  }

  const expMatch = autoLogId.match(/^auto_exp_(.+)_\d{4}-\d{2}-\d{2}$/);
  if (expMatch) {
    const rec = state.recurringExpenses.find((r) => r.id === expMatch[1]);
    if (!rec) return;
    const dates = state.transactions
      .filter((t) => t.autoLogId && t.autoLogId.startsWith('auto_exp_' + rec.id + '_'))
      .map((t) => t.date)
      .sort();
    const latest = dates[dates.length - 1] || null;
    rec.lastAutoLogDate = latest;
    if (latest) {
      const anchorDay = rec.cycle === 'monthly' ? monthlyAnchorDay(rec, 'nextDue') : null;
      rec.nextDue = currentComputeNextDueDate({ ...rec, nextDue: currentAdvanceRecurringDate(latest, rec.cycle, anchorDay) }, todayISOValue);
    } else if (deletedDate) {
      rec.nextDue = deletedDate;
    } else if (rec.nextDue) {
      rec.nextDue = currentComputeNextDueDate(rec, todayISOValue) || rec.nextDue;
    }
  }
}

function currentGetUpcomingPayEvents(state, todayISOValue, daysAhead = 30, daysBack = 0) {
  const events = [];
  const today = new Date(todayISOValue + 'T00:00:00');
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysAhead);
  const lookback = new Date(today);
  lookback.setDate(lookback.getDate() - daysBack);

  state.incomeSources.forEach((src) => {
    if (src.cycle === 'irregular' || !src.nextPay) return;
    const srcStart = parseISODateLocal(src.startDate);
    const nextPayISO = currentComputeNextPayDate(src, todayISOValue);
    let next = parseISODateLocal(nextPayISO);
    if (!next) return;
    const anchorDay = src.cycle === 'monthly' ? monthlyAnchorDay(src, 'nextPay') : null;

    if (daysBack > 0) {
      const cycleDays = src.cycle === 'weekly' ? 7 : src.cycle === 'fortnightly' ? 14 : src.cycle === 'monthly' ? 30 : 0;
      if (cycleDays > 0) {
        while (next > lookback) {
          let prev = new Date(next);
          if (src.cycle === 'weekly') prev.setDate(prev.getDate() - 7);
          else if (src.cycle === 'fortnightly') prev.setDate(prev.getDate() - 14);
          else if (src.cycle === 'monthly') prev = addMonthsClamped(prev, -1, anchorDay);
          else break;
          if (prev < lookback) break;
          if (srcStart && prev < srcStart) break;
          next = prev;
        }
      }
    }

    while (next <= horizon) {
      if (next >= lookback) {
        if (!srcStart || next >= srcStart) {
          events.push({ date: isoOf(next), srcId: src.id, amount: src.amount, name: src.name });
        }
      }
      if (src.cycle === 'weekly') next.setDate(next.getDate() + 7);
      else if (src.cycle === 'fortnightly') next.setDate(next.getDate() + 14);
      else if (src.cycle === 'monthly') next = addMonthsClamped(next, 1, anchorDay);
      else break;
    }
  });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function currentGetUpcomingBills(state, todayISOValue, daysAhead = 56) {
  const bills = [];
  const today = new Date(todayISOValue + 'T00:00:00');
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysAhead);

  state.recurringExpenses.forEach((rec) => {
    if (!rec.active || !rec.nextDue) return;
    const nextDueISO = currentComputeNextDueDate(rec, todayISOValue);
    if (!nextDueISO) return;
    const next = new Date(nextDueISO + 'T00:00:00');
    if (next < today || next > horizon) return;
    bills.push({
      id: rec.id,
      name: rec.name,
      category: rec.category,
      amount: rec.amount,
      date: nextDueISO,
      daysUntil: Math.ceil((next - today) / MS_DAY),
    });
  });

  return bills.sort((a, b) => a.date.localeCompare(b.date));
}

const tests = [];

function test(name, priority, area, expected, fn) {
  tests.push({ name, priority, area, expected, fn });
}

function equal(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

test('Weekly compute keeps Monday when saved date is Monday', 'High', 'Income schedule', 'Monday source remains Monday after many weeks', () => {
  equal(currentComputeNextPayDate({ nextPay: '2026-06-01', cycle: 'weekly' }, '2026-06-16'), '2026-06-22');
});

test('Weekly compute keeps Tuesday when saved date is Tuesday', 'High', 'Income schedule', 'Tuesday source remains Tuesday after many weeks', () => {
  equal(currentComputeNextPayDate({ nextPay: '2026-06-02', cycle: 'weekly' }, '2026-06-16'), '2026-06-16');
});

test('Fortnightly compute keeps Tuesday every 14 days', 'High', 'Income schedule', 'Fortnightly source remains same weekday', () => {
  equal(currentComputeNextPayDate({ nextPay: '2026-06-02', cycle: 'fortnightly' }, '2026-06-17'), '2026-06-30');
});

test('Auto-log Tuesday weekly advances to next Tuesday', 'High', 'Auto-log', 'Picking Tuesday today should make next pay next Tuesday', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_woolies', name: 'Woolies', amount: 400, cycle: 'weekly', nextPay: '2026-06-02', autoLog: true, lastAutoLogDate: null }],
    recurringExpenses: [],
  };
  currentRunAutoLog(state, '2026-06-02');
  equal(state.incomeSources[0].nextPay, '2026-06-09');
  equal(state.incomeSources[0].lastAutoLogDate, '2026-06-02');
});

test('Auto-log Tuesday weekly with duplicate existing transaction still advances to Tuesday', 'High', 'Auto-log', 'Duplicate prevention should not leave source stuck', () => {
  const state = {
    transactions: [{ id: 'tx_1', type: 'income', date: '2026-06-02', autoLogId: 'auto_inc_inc_woolies_2026-06-02' }],
    incomeSources: [{ id: 'inc_woolies', name: 'Woolies', amount: 400, cycle: 'weekly', nextPay: '2026-06-02', autoLog: true, lastAutoLogDate: null }],
    recurringExpenses: [],
  };
  currentRunAutoLog(state, '2026-06-02');
  equal(state.incomeSources[0].nextPay, '2026-06-09');
});

test('Monthly income auto-log recovers to 31st after February clamp', 'Medium', 'Auto-log', 'A Jan 31 monthly source should become Mar 31 after logging Feb 28', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_monthly', name: 'Monthly', amount: 1000, cycle: 'monthly', nextPay: '2026-02-28', startDate: '2026-01-31', autoLog: true }],
    recurringExpenses: [],
  };
  currentRunAutoLog(state, '2026-02-28');
  equal(state.incomeSources[0].nextPay, '2026-03-31');
});

test('Stale Monday lastAutoLogDate does not override Tuesday nextPay', 'High', 'Auto-log', 'History should not rewrite user-selected date', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_woolies', name: 'Woolies', amount: 400, cycle: 'weekly', nextPay: '2026-06-02', autoLog: true, lastAutoLogDate: '2026-06-01' }],
    recurringExpenses: [],
  };
  currentRunAutoLog(state, '2026-06-02');
  equal(state.incomeSources[0].nextPay, '2026-06-09');
});

test('Future manual correction is not overwritten by stale lastAutoLogDate', 'High', 'Auto-log', 'Choosing a future date should stick', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_restaurant', name: 'Restaurant', amount: 176, cycle: 'weekly', nextPay: '2026-06-08', autoLog: true, lastAutoLogDate: '2026-06-01' }],
    recurringExpenses: [],
  };
  currentRunAutoLog(state, '2026-06-02');
  equal(state.incomeSources[0].nextPay, '2026-06-08');
});

test('Monthly 8th remains 8th', 'High', 'Income schedule', 'Monthly normal day remains stable', () => {
  equal(currentComputeNextPayDate({ nextPay: '2026-01-08', cycle: 'monthly' }, '2026-06-02'), '2026-06-08');
});

test('Monthly 31st returns to 31st after February', 'Medium', 'Monthly schedule', 'February clamps, later months recover to the intended day', () => {
  const afterFeb = currentAdvanceRecurringDate('2026-01-31', 'monthly', 31);
  const afterMar = currentAdvanceRecurringDate(afterFeb, 'monthly', 31);
  equal([afterFeb, afterMar], ['2026-02-28', '2026-03-31']);
});

test('Monthly compute uses startDate to recover from a clamped February date', 'Medium', 'Monthly schedule', 'Saved Feb 28 with Jan 31 start should compute Mar 31', () => {
  equal(currentComputeNextPayDate({ nextPay: '2026-02-28', startDate: '2026-01-31', cycle: 'monthly' }, '2026-03-01'), '2026-03-31');
});

test('Monthly 30th clamps in February then returns to 30th', 'Medium', 'Monthly schedule', '30th schedules should not become 28th forever', () => {
  const afterFeb = currentAdvanceRecurringDate('2026-01-30', 'monthly', 30);
  const afterMar = currentAdvanceRecurringDate(afterFeb, 'monthly', 30);
  equal([afterFeb, afterMar], ['2026-02-28', '2026-03-30']);
});

test('Monthly 29th handles leap year February', 'Medium', 'Monthly schedule', 'Leap-year February should support the 29th', () => {
  const afterFeb = currentAdvanceRecurringDate('2024-01-29', 'monthly', 29);
  const afterMar = currentAdvanceRecurringDate(afterFeb, 'monthly', 29);
  equal([afterFeb, afterMar], ['2024-02-29', '2024-03-29']);
});

test('Recurring weekly expense keeps Wednesday', 'High', 'Recurring expenses', 'Wednesday recurring bill remains Wednesday', () => {
  equal(currentComputeNextDueDate({ nextDue: '2026-06-03', cycle: 'weekly' }, '2026-06-16'), '2026-06-17');
});

test('Recurring monthly 31st returns to 31st after February', 'Medium', 'Recurring expenses', 'Monthly bill on 31st should not become 28th forever', () => {
  const afterFeb = currentAdvanceRecurringDate('2026-01-31', 'monthly', 31);
  const afterMar = currentAdvanceRecurringDate(afterFeb, 'monthly', 31);
  equal([afterFeb, afterMar], ['2026-02-28', '2026-03-31']);
});

test('Recurring monthly due date uses startDate to recover from February clamp', 'Medium', 'Recurring expenses', 'Saved Feb 28 with Jan 31 start should compute Mar 31', () => {
  equal(currentComputeNextDueDate({ nextDue: '2026-02-28', startDate: '2026-01-31', cycle: 'monthly' }, '2026-03-01'), '2026-03-31');
});

test('Deleting the only auto-logged income leaves nextPay advanced instead of restoring deleted date', 'High', 'Delete auto-log', 'Deleting today auto-log should let source be due today again or clearly ask user', () => {
  const state = {
    transactions: [
      { id: 'tx_1', type: 'income', date: '2026-06-02', autoLogId: 'auto_inc_inc_woolies_2026-06-02' },
    ],
    incomeSources: [{ id: 'inc_woolies', name: 'Woolies', amount: 400, cycle: 'weekly', nextPay: '2026-06-09', autoLog: true, lastAutoLogDate: '2026-06-02' }],
    recurringExpenses: [],
  };
  const deleted = state.transactions[0];
  state.transactions = state.transactions.filter((t) => t.id !== deleted.id);
  currentRefreshAutoLogSourceState(state, deleted.autoLogId, '2026-06-02', deleted.date);
  equal({ nextPay: state.incomeSources[0].nextPay, lastAutoLogDate: state.incomeSources[0].lastAutoLogDate }, { nextPay: '2026-06-02', lastAutoLogDate: null });
});

test('Deleting the only auto-logged expense leaves nextDue advanced instead of restoring deleted date', 'Medium', 'Delete auto-log', 'Deleting today bill auto-log should let bill be due today again or clearly ask user', () => {
  const state = {
    transactions: [
      { id: 'tx_1', type: 'expense', date: '2026-06-02', autoLogId: 'auto_exp_rec_rent_2026-06-02' },
    ],
    incomeSources: [],
    recurringExpenses: [{ id: 'rec_rent', name: 'Rent', amount: 547, cycle: 'weekly', nextDue: '2026-06-09', active: true, lastAutoLogDate: '2026-06-02' }],
  };
  const deleted = state.transactions[0];
  state.transactions = state.transactions.filter((t) => t.id !== deleted.id);
  currentRefreshAutoLogSourceState(state, deleted.autoLogId, '2026-06-02', deleted.date);
  equal({ nextDue: state.recurringExpenses[0].nextDue, lastAutoLogDate: state.recurringExpenses[0].lastAutoLogDate }, { nextDue: '2026-06-02', lastAutoLogDate: null });
});

test('Deleting latest monthly income auto-log keeps 31st anchor from older log', 'Medium', 'Delete auto-log', 'After deleting Mar 31, remaining Feb 28 log should set next pay back to Mar 31', () => {
  const state = {
    transactions: [
      { id: 'tx_1', type: 'income', date: '2026-02-28', autoLogId: 'auto_inc_inc_monthly_2026-02-28' },
    ],
    incomeSources: [{ id: 'inc_monthly', name: 'Monthly', amount: 1000, cycle: 'monthly', nextPay: '2026-04-30', startDate: '2026-01-31', autoLog: true, lastAutoLogDate: '2026-03-31' }],
    recurringExpenses: [],
  };
  currentRefreshAutoLogSourceState(state, 'auto_inc_inc_monthly_2026-03-31', '2026-03-31', '2026-03-31');
  equal({ nextPay: state.incomeSources[0].nextPay, lastAutoLogDate: state.incomeSources[0].lastAutoLogDate }, { nextPay: '2026-03-31', lastAutoLogDate: '2026-02-28' });
});

test('Deleting latest monthly expense auto-log keeps 31st anchor from older log', 'Medium', 'Delete auto-log', 'After deleting Mar 31, remaining Feb 28 log should set next due back to Mar 31', () => {
  const state = {
    transactions: [
      { id: 'tx_1', type: 'expense', date: '2026-02-28', autoLogId: 'auto_exp_rec_monthly_2026-02-28' },
    ],
    incomeSources: [],
    recurringExpenses: [{ id: 'rec_monthly', name: 'Monthly', amount: 100, category: 'home', cycle: 'monthly', nextDue: '2026-04-30', startDate: '2026-01-31', active: true, lastAutoLogDate: '2026-03-31' }],
  };
  currentRefreshAutoLogSourceState(state, 'auto_exp_rec_monthly_2026-03-31', '2026-03-31', '2026-03-31');
  equal({ nextDue: state.recurringExpenses[0].nextDue, lastAutoLogDate: state.recurringExpenses[0].lastAutoLogDate }, { nextDue: '2026-03-31', lastAutoLogDate: '2026-02-28' });
});

test('Upcoming monthly pay events from 31st should not skip or drift', 'Medium', 'Forecast', 'Forecast should emit Jan31, Feb28, Mar31 style dates', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_m', name: 'Monthly31', amount: 1000, cycle: 'monthly', nextPay: '2026-01-31', startDate: '2026-01-31' }],
    recurringExpenses: [],
  };
  const dates = currentGetUpcomingPayEvents(state, '2026-01-31', 70).map((e) => e.date);
  equal(dates.slice(0, 3), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('Forecast skips invalid income source dates', 'Medium', 'Forecast', 'Bad saved income dates should not create fake forecast events', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_bad', name: 'Bad', amount: 100, cycle: 'weekly', nextPay: 'bad-date', startDate: 'bad-date' }],
    recurringExpenses: [],
  };
  equal(currentGetUpcomingPayEvents(state, '2026-06-02', 30), []);
});

test('Invalid date strings should not silently become NaN output', 'Medium', 'Data safety', 'Bad saved dates should be rejected or ignored safely', () => {
  const value = currentComputeNextPayDate({ nextPay: 'bad-date', cycle: 'weekly' }, '2026-06-02');
  assert(value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), `Unsafe output: ${value}`);
});

test('Invalid recurring expense date should not become NaN output', 'Medium', 'Data safety', 'Bad saved recurring dates should be ignored safely', () => {
  const value = currentComputeNextDueDate({ nextDue: '2026-02-31', cycle: 'monthly' }, '2026-06-02');
  equal(value, null);
});

test('Auto-log ignores invalid income dates without creating transactions', 'Medium', 'Data safety', 'Bad saved income dates should not create bad auto-logs', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_bad', name: 'Bad', amount: 100, cycle: 'weekly', nextPay: 'bad-date', autoLog: true }],
    recurringExpenses: [],
  };
  currentRunAutoLog(state, '2026-06-02');
  equal(state.transactions, []);
  equal(state.incomeSources[0].nextPay, 'bad-date');
});

test('Auto-log ignores invalid recurring expense dates without creating transactions', 'Medium', 'Data safety', 'Bad saved bill dates should not create bad auto-logs', () => {
  const state = {
    transactions: [],
    incomeSources: [],
    recurringExpenses: [{ id: 'rec_bad', name: 'Bad', amount: 100, category: 'home', cycle: 'weekly', nextDue: '2026-02-31', active: true }],
  };
  currentRunAutoLog(state, '2026-06-02');
  equal(state.transactions, []);
  equal(state.recurringExpenses[0].nextDue, '2026-02-31');
});

test('No date-only UTC conversion exists in test harness', 'High', 'Timezone', 'Local date strings are not sent through toISOString', () => {
  const d = new Date('2026-06-02T00:00:00');
  equal(isoOf(d), '2026-06-02');
});

test('Recurring expense future manual correction is not overwritten by stale lastAutoLogDate', 'High', 'Recurring expenses', 'Choosing a future due date should stick', () => {
  const state = {
    transactions: [],
    incomeSources: [],
    recurringExpenses: [{ id: 'rec_cleaning', name: 'Cleaning', amount: 125, cycle: 'weekly', nextDue: '2026-06-10', active: true, lastAutoLogDate: '2026-06-03' }],
  };
  currentRunAutoLog(state, '2026-06-02');
  equal(state.recurringExpenses[0].nextDue, '2026-06-10');
});

test('Recurring weekly expense due today advances to next same weekday', 'High', 'Recurring expenses', 'Wednesday bill should become next Wednesday after auto-log', () => {
  const state = {
    transactions: [],
    incomeSources: [],
    recurringExpenses: [{ id: 'rec_cleaning', name: 'Cleaning', amount: 125, cycle: 'weekly', nextDue: '2026-06-03', active: true, lastAutoLogDate: null }],
  };
  currentRunAutoLog(state, '2026-06-03');
  equal(state.recurringExpenses[0].nextDue, '2026-06-10');
});

test('Monthly expense auto-log recovers to 31st after February clamp', 'Medium', 'Auto-log', 'A Jan 31 monthly bill should become Mar 31 after logging Feb 28', () => {
  const state = {
    transactions: [],
    incomeSources: [],
    recurringExpenses: [{ id: 'rec_monthly', name: 'Monthly', amount: 100, category: 'home', cycle: 'monthly', nextDue: '2026-02-28', startDate: '2026-01-31', active: true }],
  };
  currentRunAutoLog(state, '2026-02-28');
  equal(state.recurringExpenses[0].nextDue, '2026-03-31');
});

test('Upcoming weekly pay events remain on Tuesday', 'High', 'Forecast', 'Forecast should list Tuesday dates for Tuesday source', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_woolies', name: 'Woolies', amount: 400, cycle: 'weekly', nextPay: '2026-06-09', startDate: '2026-06-09' }],
    recurringExpenses: [],
  };
  const dates = currentGetUpcomingPayEvents(state, '2026-06-02', 21).map((e) => e.date);
  equal(dates, ['2026-06-09', '2026-06-16', '2026-06-23']);
});

test('Upcoming fortnightly pay events remain on Tuesday', 'High', 'Forecast', 'Forecast should list every second Tuesday', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_fort', name: 'Fortnightly', amount: 400, cycle: 'fortnightly', nextPay: '2026-06-09', startDate: '2026-06-09' }],
    recurringExpenses: [],
  };
  const dates = currentGetUpcomingPayEvents(state, '2026-06-02', 35).map((e) => e.date);
  equal(dates, ['2026-06-09', '2026-06-23', '2026-07-07']);
});

test('Future startDate blocks earlier forecast events', 'Medium', 'Forecast', 'Source should not appear before it starts', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_future', name: 'Future', amount: 400, cycle: 'weekly', nextPay: '2026-06-03', startDate: '2026-06-17' }],
    recurringExpenses: [],
  };
  const dates = currentGetUpcomingPayEvents(state, '2026-06-02', 21).map((e) => e.date);
  equal(dates, ['2026-06-17']);
});

test('Recurring bill list returns next active weekly bill', 'High', 'Recurring expenses', 'Upcoming bill should be the next due date only', () => {
  const state = {
    recurringExpenses: [{ id: 'rec_cleaning', name: 'Cleaning', amount: 125, category: 'home', cycle: 'weekly', nextDue: '2026-06-03', active: true }],
  };
  const bills = currentGetUpcomingBills(state, '2026-06-02', 14);
  equal(bills.map((b) => b.date), ['2026-06-03']);
});

test('Inactive recurring bill is excluded from upcoming bills', 'Medium', 'Recurring expenses', 'Paused bill should not appear', () => {
  const state = {
    recurringExpenses: [{ id: 'rec_paused', name: 'Paused', amount: 100, category: 'home', cycle: 'weekly', nextDue: '2026-06-03', active: false }],
  };
  equal(currentGetUpcomingBills(state, '2026-06-02', 14), []);
});

test('Auto-log cap leaves very old weekly income still in the past', 'Medium', 'Auto-log', 'Long gaps should catch up or clearly stop safely', () => {
  const state = {
    transactions: [],
    incomeSources: [{ id: 'inc_old', name: 'Old', amount: 100, cycle: 'weekly', nextPay: '2020-01-06', autoLog: true, lastAutoLogDate: null }],
    recurringExpenses: [],
  };
  currentRunAutoLog(state, '2026-06-02');
  assert(state.incomeSources[0].nextPay > '2026-06-02', `Still due today or in past: ${state.incomeSources[0].nextPay}`);
});

test('Auto-log cap leaves very old weekly expense still in the past', 'Medium', 'Auto-log', 'Long gaps should catch up or clearly stop safely', () => {
  const state = {
    transactions: [],
    incomeSources: [],
    recurringExpenses: [{ id: 'rec_old', name: 'Old', amount: 100, category: 'home', cycle: 'weekly', nextDue: '2020-01-06', active: true, lastAutoLogDate: null }],
  };
  currentRunAutoLog(state, '2026-06-02');
  assert(state.recurringExpenses[0].nextDue > '2026-06-02', `Still due today or in past: ${state.recurringExpenses[0].nextDue}`);
});

test('Visible version labels match APP_VERSION', 'Low', 'Versioning', 'Tester should see the same version the code uses', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const appVersion = html.match(/const APP_VERSION = '([^']+)'/)[1];
  const stale = [...html.matchAll(/>(?:v|Ledger Compass v)?(2\.\d+\.\d+)</g)]
    .map((m) => m[1])
    .filter((v) => v !== appVersion);
  equal(stale, []);
});

test('App code has no date-only toISOString slice', 'High', 'Timezone', 'Old UTC bug should not return', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert(!/toISOString\(\)\.slice\(0,\s*10\)/.test(html), 'Found toISOString().slice(0,10)');
});

test('App code does not use input.valueAsDate for native date inputs', 'High', 'Timezone', 'Native picker should stay as YYYY-MM-DD text', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  assert(!/valueAsDate|valueAsNumber/.test(html), 'Found valueAsDate/valueAsNumber');
});

const results = tests.map((t) => {
  try {
    t.fn();
    return { ...t, status: 'PASS', actual: 'Matched expectation' };
  } catch (error) {
    return { ...t, status: 'FAIL', actual: error.message };
  }
});

const summary = results.reduce((acc, r) => {
  acc.total++;
  acc[r.status.toLowerCase()]++;
  acc.byPriority[r.priority] = acc.byPriority[r.priority] || { pass: 0, fail: 0 };
  acc.byPriority[r.priority][r.status.toLowerCase()]++;
  return acc;
}, { total: 0, pass: 0, fail: 0, byPriority: {} });

console.log(JSON.stringify({ summary, results }, null, 2));
