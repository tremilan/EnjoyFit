function siteRoot() {
  const path = window.location.pathname;
  const marker = '/rezervace/';
  const idx = path.indexOf(marker);
  if (idx >= 0) return path.slice(0, idx);
  return '';
}

function apiUrl(path) {
  return `${siteRoot()}${path}`;
}

class RezervacniKalendar {
  constructor({ branch, branchName }) {
    this.branch = branch;
    this.branchName = branchName;
    this.currentDate = new Date();
    this.lessons = [];
    this.adminPin = sessionStorage.getItem(`admin-${branch}`) || null;

    this.el = {
      monthTitle: document.getElementById('monthTitle'),
      calGrid: document.getElementById('calGrid'),
      adminBar: document.getElementById('adminBar'),
      modal: document.getElementById('modal'),
      modalTitle: document.getElementById('modalTitle'),
      modalSubtitle: document.getElementById('modalSubtitle'),
      slotsGrid: document.getElementById('slotsGrid'),
      modalAdmin: document.getElementById('modalAdmin'),
      toast: document.getElementById('toast'),
      serverAlert: document.getElementById('serverAlert'),
      modalTimeEdit: document.getElementById('modalTimeEdit'),
      modalCancel: document.getElementById('modalCancel'),
      modalBookingForm: document.getElementById('modalBookingForm'),
      lessonFormModal: document.getElementById('lessonFormModal'),
      lessonFormDate: document.getElementById('lessonFormDate'),
      timeFrom: document.getElementById('timeFrom'),
      timeTo: document.getElementById('timeTo'),
      exerciseType: document.getElementById('exerciseType'),
      maxSlots: document.getElementById('maxSlots'),
      lessonPrice: document.getElementById('lessonPrice'),
      bookingHp: document.getElementById('bookingHp'),
      contactsToggle: document.getElementById('contactsToggle'),
      contactsModal: document.getElementById('contactsModal'),
      contactsTableWrap: document.getElementById('contactsTableWrap'),
    };

    this.activeLesson = null;
    this.lessonBookings = [];
    this.selectedSlot = null;
    this.adminDetailSlot = null;
    this.modalOpenedAt = null;
    this.bindEvents();
    this.updateAdminUI();
    this.render();
  }

  bindEvents() {
    document.getElementById('prevMonth').addEventListener('click', () => this.shiftMonth(-1));
    document.getElementById('nextMonth').addEventListener('click', () => this.shiftMonth(1));
    document.getElementById('adminToggle').addEventListener('click', () => this.toggleAdmin());
    document.getElementById('contactsToggle')?.addEventListener('click', () => this.openContacts());
    document.getElementById('contactsClose')?.addEventListener('click', () => this.closeContacts());
    document.getElementById('contactsExport')?.addEventListener('click', () => this.exportContacts());
    this.el.contactsModal?.addEventListener('click', (e) => {
      if (e.target === this.el.contactsModal) this.closeContacts();
    });
    document.getElementById('modalClose').addEventListener('click', () => this.closeModal());
    document.getElementById('lessonFormCancel').addEventListener('click', () => this.closeLessonForm());
    document.getElementById('lessonFormSave').addEventListener('click', () => this.saveNewLesson());
    this.el.lessonFormModal.addEventListener('click', (e) => {
      if (e.target === this.el.lessonFormModal) this.closeLessonForm();
    });
  }

  formatExerciseType(lesson) {
    return (lesson.title || '').trim();
  }

  lessonCapacity(lesson) {
    const slots = parseInt(lesson?.max_slots, 10);
    return Number.isFinite(slots) && slots > 0 ? slots : 20;
  }

  parseSlotCount(value) {
    const parsed = parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
      return null;
    }
    return parsed;
  }

  lessonPrice(lesson) {
    const price = parseInt(lesson?.price, 10);
    return Number.isFinite(price) && price >= 0 ? price : 200;
  }

  parsePrice(value) {
    const parsed = parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
      return null;
    }
    return parsed;
  }

  formatLessonPrice(lesson) {
    return `Cena ${this.lessonPrice(lesson)} Kč/osoba`;
  }

  renderLessonSubtitle(lesson) {
    const timeLabel = this.formatLessonTime(lesson);
    return `
      <div class="modal__meta">
        <span class="modal__date">${this.formatDateLabel(lesson.date)}</span>
        ${timeLabel
          ? `<span class="modal__time">${timeLabel}</span>`
          : '<span class="modal__time modal__time--missing">Čas lekce zatím není vyplněn</span>'}
        <span class="modal__price">${this.formatLessonPrice(lesson)}</span>
      </div>`;
  }

  isLessonBookable(lesson) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lessonDate = new Date(`${lesson.date}T12:00:00`);
    return lessonDate >= today;
  }

  bookingPayload(name, email, phone) {
    return {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      gdpr_consent: Boolean(document.getElementById('gdprConsent')?.checked),
      website: this.el.bookingHp?.value || '',
      opened_at: this.modalOpenedAt || Date.now(),
    };
  }

  hasGdprConsent() {
    return Boolean(this.adminPin || document.getElementById('gdprConsent')?.checked);
  }

  formatLessonTime(lesson) {
    if (lesson.time_from && lesson.time_to) {
      return `${lesson.time_from}–${lesson.time_to}`;
    }
    return '';
  }

  formatDateLabel(dateStr) {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('cs-CZ', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  monthKey() {
    const y = this.currentDate.getFullYear();
    const m = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  monthLabel() {
    return this.currentDate.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
  }

  shiftMonth(delta) {
    this.currentDate.setMonth(this.currentDate.getMonth() + delta);
    this.render();
  }

  async api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.adminPin) headers['X-Admin-Pin'] = this.adminPin;

    const res = await fetch(apiUrl(path), { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Chyba serveru');
    return data;
  }

  async loadLessons() {
    this.lessons = await this.api(`/api/lessons/${this.branch}?month=${this.monthKey()}`);
  }

  async render() {
    this.el.monthTitle.textContent = this.monthLabel();
    this.hideAlert();

    try {
      await this.loadLessons();
    } catch (err) {
      this.lessons = [];
      this.showAlert(
        `Kalendář nelze načíst ze serveru (${err.message}). Spusťte: python3 server.py a otevřete http://localhost:3000/rezervace/${this.branch}.html`
      );
      console.error(err);
    }

    this.renderCalendar();
  }

  showAlert(msg) {
    if (!this.el.serverAlert) return;
    this.el.serverAlert.textContent = msg;
    this.el.serverAlert.hidden = false;
  }

  hideAlert() {
    if (!this.el.serverAlert) return;
    this.el.serverAlert.hidden = true;
  }

  lessonOnDate(dateStr) {
    return this.lessons.find((l) => l.date === dateStr);
  }

  renderCalendar() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = (firstDay.getDay() + 6) % 7;

    const weekdays = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
    let html = weekdays.map((d) => `<div class="cal-weekday">${d}</div>`).join('');

    for (let i = 0; i < startPad; i++) {
      html += '<div class="cal-day cal-day--empty"></div>';
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const lesson = this.lessonOnDate(dateStr);
      const cellDate = new Date(year, month, day);

      if (lesson) {
        const capacity = this.lessonCapacity(lesson);
        const full = lesson.booked_count >= capacity;
        const fill = capacity > 0
          ? Math.min(100, Math.round((lesson.booked_count / capacity) * 100))
          : 0;
        const timeLabel = this.formatLessonTime(lesson);
        const typeLabel = this.formatExerciseType(lesson);
        html += `
          <button type="button" class="cal-day cal-day--lesson${full ? ' cal-day--full' : ''}"
                  data-lesson-id="${lesson.id}" style="--fill: ${fill}%"
                  aria-label="${typeLabel || 'Lekce'} ${day}. ${this.monthLabel()}${timeLabel ? ' ' + timeLabel : ''}">
            <div class="cal-day__bg" aria-hidden="true">
              <span class="cal-day__fill"></span>
            </div>
            <div class="cal-day__content">
              <span class="cal-day__date">${day}</span>
              <div class="cal-day__details">
                ${timeLabel ? `<span class="cal-day__time">${timeLabel}</span>` : ''}
                <span class="cal-day__info">obsazeno: ${lesson.booked_count}/${capacity}</span>
                ${typeLabel ? `<span class="cal-day__type">${this.escape(typeLabel)}</span>` : ''}
              </div>
            </div>
          </button>`;
      } else if (this.adminPin && cellDate >= today) {
        html += `
          <button type="button" class="cal-day cal-day--no-lesson cal-day--admin-add"
                  data-add-date="${dateStr}" aria-label="Přidat lekci ${day}.">
            <span class="cal-day__num">${day}</span>
            <span class="cal-day__info cal-day__info--add">+ lekce</span>
          </button>`;
      } else {
        html += `<div class="cal-day cal-day--no-lesson"><span class="cal-day__num">${day}</span></div>`;
      }
    }

    this.el.calGrid.innerHTML = html;

    this.el.calGrid.querySelectorAll('[data-lesson-id]').forEach((btn) => {
      btn.addEventListener('click', () => this.openLesson(btn.dataset.lessonId));
    });

    this.el.calGrid.querySelectorAll('[data-add-date]').forEach((btn) => {
      btn.addEventListener('click', () => this.addLesson(btn.dataset.addDate));
    });
  }

  toggleAdmin() {
    if (this.adminPin) {
      this.adminPin = null;
      sessionStorage.removeItem(`admin-${this.branch}`);
      this.showToast('Admin režim vypnut');
    } else {
      const pin = prompt('Zadejte admin PIN:');
      if (!pin) return;
      this.adminPin = pin;
      sessionStorage.setItem(`admin-${this.branch}`, pin);
    }
    this.updateAdminUI();
    this.render();
  }

  updateAdminUI() {
    const isAdmin = Boolean(this.adminPin);
    this.el.adminBar.classList.toggle('rezervace-admin-bar--visible', isAdmin);
    document.getElementById('adminToggle').textContent = isAdmin ? 'Odhlásit admin' : 'Admin';
    if (this.el.contactsToggle) {
      this.el.contactsToggle.classList.toggle('rezervace-header__contacts--visible', isAdmin);
      this.el.contactsToggle.setAttribute('aria-hidden', String(!isAdmin));
    }
    if (!isAdmin) this.closeContacts();
  }

  formatContactDate(value) {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('cs-CZ', {
      day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  formatPhoneDisplay(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length !== 9) return phone || '';
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  async openContacts() {
    if (!this.adminPin) return;
    try {
      const contacts = await this.api('/api/contacts');
      this.renderContactsTable(contacts);
      this.el.contactsModal?.classList.add('modal-overlay--open');
    } catch (err) {
      alert(err.message);
    }
  }

  closeContacts() {
    this.el.contactsModal?.classList.remove('modal-overlay--open');
    if (this.el.contactsTableWrap) this.el.contactsTableWrap.innerHTML = '';
  }

  renderContactsTable(contacts) {
    if (!this.el.contactsTableWrap) return;
    if (!contacts.length) {
      this.el.contactsTableWrap.innerHTML = '<p class="contacts-empty">Zatím žádné kontakty.</p>';
      return;
    }

    const rows = contacts.map((c) => `
      <tr>
        <td class="contacts-table__col-name">${this.escape(c.name)}</td>
        <td class="contacts-table__col-email"><a href="mailto:${this.escapeAttr(c.email)}">${this.escape(c.email)}</a></td>
        <td class="contacts-table__col-phone"><a href="tel:+420${this.escapeAttr(c.phone)}">${this.escape(this.formatPhoneDisplay(c.phone))}</a></td>
        <td class="contacts-table__col-date">${this.escape(this.formatContactDate(c.first_seen_at))}</td>
        <td class="contacts-table__col-date">${this.escape(this.formatContactDate(c.updated_at))}</td>
      </tr>`).join('');

    this.el.contactsTableWrap.innerHTML = `
      <table class="contacts-table">
        <thead>
          <tr>
            <th>Jméno</th>
            <th>E-mail</th>
            <th>Telefon</th>
            <th>První kontakt</th>
            <th>Naposledy</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="contacts-count">Celkem ${contacts.length} kontaktů</p>`;
  }

  async exportContacts() {
    if (!this.adminPin) return;
    try {
      const res = await fetch(apiUrl('/api/contacts/export'), {
        headers: { 'X-Admin-Pin': this.adminPin },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export se nezdařil');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'kontakty-enjoy-team.csv';
      link.click();
      URL.revokeObjectURL(url);
      this.showToast('CSV staženo');
    } catch (err) {
      alert(err.message);
    }
  }

  openLessonForm(date) {
    this.pendingLessonDate = date;
    this.el.lessonFormDate.textContent = this.formatDateLabel(date);
    this.el.timeFrom.value = '18:30';
    this.el.timeTo.value = '19:30';
    this.el.exerciseType.value = '';
    if (this.el.maxSlots) this.el.maxSlots.value = '20';
    if (this.el.lessonPrice) this.el.lessonPrice.value = '200';
    this.el.lessonFormModal.classList.add('modal-overlay--open');
  }

  closeLessonForm() {
    this.pendingLessonDate = null;
    this.el.lessonFormModal.classList.remove('modal-overlay--open');
  }

  async saveNewLesson() {
    if (!this.pendingLessonDate) return;

    try {
      const title = this.el.exerciseType.value.trim();
      if (title.length < 2) {
        alert('Vyplňte typ cvičení (min. 2 znaky)');
        return;
      }

      const maxSlots = this.parseSlotCount(this.el.maxSlots?.value);
      if (maxSlots === null) {
        alert('Počet míst musí být celé číslo mezi 1 a 100');
        return;
      }

      const price = this.parsePrice(this.el.lessonPrice?.value);
      if (price === null) {
        alert('Cena musí být celé číslo mezi 0 a 100 000');
        return;
      }

      await this.api('/api/lessons', {
        method: 'POST',
        body: JSON.stringify({
          branch: this.branch,
          date: this.pendingLessonDate,
          title,
          time_from: this.el.timeFrom.value,
          time_to: this.el.timeTo.value,
          max_slots: maxSlots,
          price,
        }),
      });
      this.closeLessonForm();
      this.showToast('Lekce přidána');
      this.render();
    } catch (err) {
      alert(err.message);
    }
  }

  addLesson(date) {
    this.openLessonForm(date);
  }

  renderLessonSlots(lessonId, bookings, capacity, bookable = true) {
    const booked = Object.fromEntries(bookings.map((b) => [b.slot, b]));
    const isAdmin = Boolean(this.adminPin);
    let slotsHtml = '';

    for (let slot = 1; slot <= capacity; slot++) {
      const booking = booked[slot];
      const taken = Boolean(booking);
      const adminTaken = isAdmin && taken;
      const canSelectFree = bookable && !taken;
      const isSelected = this.adminDetailSlot === slot || (this.selectedSlot === slot && !taken);
      const statusLabel = taken ? 'Obsazeno' : 'Volné';
      const statusClass = taken ? 'slot-pill__status--taken' : 'slot-pill__status--free';
      const tag = (canSelectFree || adminTaken) ? 'button' : 'div';
      const pillClass = taken
        ? `slot-pill slot-pill--taken${isAdmin ? ' slot-pill--admin' : ''}${adminTaken ? ' slot-pill--taken-clickable' : ''}${isSelected ? ' slot-pill--selected' : ''}`
        : `slot-pill slot-pill--free${isSelected ? ' slot-pill--selected' : ''}`;

      slotsHtml += `
        <${tag}${(canSelectFree || adminTaken) ? ' type="button"' : ''} class="${pillClass}" data-slot="${slot}"${taken && booking?.name ? ` data-name="${this.escapeAttr(booking.name)}"` : ''}>
          <span class="slot-pill__num">Místo ${slot}</span>
          <span class="slot-pill__status ${statusClass}">${statusLabel}</span>
          ${adminTaken ? '<span class="slot-pill__hint">Zobrazit klienta</span>' : ''}
        </${tag}>`;
    }

    this.el.slotsGrid.innerHTML = slotsHtml;
    this.el.slotsGrid.hidden = Boolean(this.selectedSlot && !isAdmin);

    if (isAdmin) {
      this.el.slotsGrid.hidden = false;
      this.el.slotsGrid.querySelectorAll('.slot-pill--taken-clickable').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.openAdminBookingDetail(lessonId, Number(btn.dataset.slot), booked[Number(btn.dataset.slot)]);
        });
      });
    }

    if (bookable) {
      this.el.slotsGrid.querySelectorAll('.slot-pill--free').forEach((btn) => {
        btn.addEventListener('click', () => this.openBookingForm(lessonId, Number(btn.dataset.slot)));
      });
    }
  }

  openAdminBookingDetail(lessonId, slot, booking) {
    if (!booking || !this.el.modalBookingForm) return;

    this.adminDetailSlot = slot;
    this.selectedSlot = null;

    const phone = this.formatPhoneDisplay(booking.phone || '');
    const telHref = booking.phone ? `+420${String(booking.phone).replace(/\D/g, '')}` : '';

    this.el.modalBookingForm.hidden = false;
    this.el.modalBookingForm.innerHTML = `
      <div class="booking-form admin-booking-detail">
        <button type="button" class="booking-form__back" id="adminDetailBack">← Zpět na místa</button>
        <h4 class="booking-form__title">Místo ${slot} · Obsazeno</h4>
        <dl class="admin-booking-detail__list">
          <div class="admin-booking-detail__row">
            <dt>Jméno</dt>
            <dd>${this.escape(booking.name || '—')}</dd>
          </div>
          <div class="admin-booking-detail__row">
            <dt>E-mail</dt>
            <dd>${booking.email
              ? `<a href="mailto:${this.escapeAttr(booking.email)}">${this.escape(booking.email)}</a>`
              : '—'}</dd>
          </div>
          <div class="admin-booking-detail__row">
            <dt>Telefon</dt>
            <dd>${booking.phone
              ? `<a href="tel:${this.escapeAttr(telHref)}">${this.escape(phone)}</a>`
              : '—'}</dd>
          </div>
        </dl>
        <button type="button" class="rezervace-btn modal__cancel-btn" id="adminDetailDelete">Smazat rezervaci</button>
      </div>`;

    document.getElementById('adminDetailBack')?.addEventListener('click', () => this.closeBookingForm(lessonId));
    document.getElementById('adminDetailDelete')?.addEventListener('click', () => {
      this.deleteBooking(lessonId, slot, booking.name || '');
    });

    this.el.slotsGrid?.querySelectorAll('.slot-pill').forEach((pill) => {
      pill.classList.toggle('slot-pill--selected', Number(pill.dataset.slot) === slot);
    });
  }

  openBookingForm(lessonId, slot) {
    const isAdmin = Boolean(this.adminPin);
    this.selectedSlot = slot;
    this.adminDetailSlot = null;
    if (!this.el.modalBookingForm) return;

    const gdprHtml = isAdmin ? '' : `
      <label class="gdpr-consent">
        <input type="checkbox" id="gdprConsent" name="gdpr_consent" required>
        <span>
          Souhlasím se zpracováním osobních údajů (jméno, e-mail, telefon) za účelem rezervace lekce
          a vedení kontaktu. Údaje mohou být uchovávány i po zrušení rezervace.
          Více v <a href="../ochrana-udaju.html" target="_blank" rel="noopener">Zásadách ochrany osobních údajů</a>.
        </span>
      </label>`;

    this.el.modalBookingForm.hidden = false;
    this.el.modalBookingForm.innerHTML = `
      <div class="booking-form">
        <button type="button" class="booking-form__back" id="bookingFormBack">← Zpět na místa</button>
        <h4 class="booking-form__title">Rezervace místa ${slot}</h4>
        <div class="booking-form__fields">
          <label class="booking-form__field">
            <span>Jméno</span>
            <input class="booking-form__input booking-form__input--name" type="text" maxlength="40" placeholder="Vaše jméno" autocomplete="name">
          </label>
          <label class="booking-form__field">
            <span>E-mail</span>
            <input class="booking-form__input booking-form__input--email" type="email" maxlength="120" placeholder="vas@email.cz" autocomplete="email">
          </label>
          <label class="booking-form__field">
            <span>Telefon</span>
            <input class="booking-form__input booking-form__input--phone" type="tel" maxlength="20" placeholder="733 352 478" autocomplete="tel">
          </label>
        </div>
        ${gdprHtml}
        <button type="button" class="rezervace-btn booking-form__submit" id="bookingFormSubmit">Rezervovat místo ${slot}</button>
      </div>`;

    if (!isAdmin) {
      this.el.slotsGrid.hidden = true;
    }

    document.getElementById('bookingFormBack')?.addEventListener('click', () => this.closeBookingForm(lessonId));
    document.getElementById('bookingFormSubmit')?.addEventListener('click', () => this.bookSlot(lessonId, slot));
    this.el.modalBookingForm.querySelector('.booking-form__input--name')?.focus();
  }

  closeBookingForm(lessonId) {
    this.selectedSlot = null;
    this.adminDetailSlot = null;
    if (this.el.modalBookingForm) {
      this.el.modalBookingForm.hidden = true;
      this.el.modalBookingForm.innerHTML = '';
    }
    if (this.el.slotsGrid) this.el.slotsGrid.hidden = false;
    if (lessonId && this.activeLesson) {
      const capacity = this.lessonCapacity(this.activeLesson);
      this.api(`/api/lessons/${lessonId}/bookings`)
        .then(({ bookings }) => {
          this.lessonBookings = bookings;
          this.renderLessonSlots(
            lessonId,
            bookings,
            capacity,
            this.isLessonBookable(this.activeLesson),
          );
        })
        .catch(() => {});
    }
  }

  renderCancelForm(lessonId, bookable) {
    if (!this.el.modalCancel) return;
    if (this.adminPin || !bookable) {
      this.el.modalCancel.innerHTML = '';
      return;
    }

    this.el.modalCancel.innerHTML = `
      <div class="modal__cancel">
        <p class="modal__cancel-title">Zrušit mou rezervaci</p>
        <p class="modal__cancel-hint">Zadejte stejné údaje jako při rezervaci.</p>
        <div class="modal__cancel-fields">
          <label class="modal__cancel-field">
            <span>Číslo místa</span>
            <input type="number" id="cancelSlot" min="1" max="100" placeholder="např. 3">
          </label>
          <label class="modal__cancel-field">
            <span>E-mail</span>
            <input type="email" id="cancelEmail" maxlength="120" placeholder="vas@email.cz" autocomplete="email">
          </label>
          <label class="modal__cancel-field">
            <span>Telefon</span>
            <input type="tel" id="cancelPhone" maxlength="20" placeholder="733 352 478" autocomplete="tel">
          </label>
        </div>
        <button type="button" class="rezervace-btn modal__cancel-btn" id="cancelBookingBtn">Zrušit rezervaci</button>
      </div>`;

    document.getElementById('cancelBookingBtn')?.addEventListener('click', () => {
      this.cancelBooking(lessonId);
    });
  }

  setupLessonEditForm(lesson, bookings) {
    this.lessonEdit = {
      title: document.getElementById('editExerciseType'),
      timeFrom: document.getElementById('editTimeFrom'),
      timeTo: document.getElementById('editTimeTo'),
      maxSlots: document.getElementById('editMaxSlots'),
      price: document.getElementById('editPrice'),
      saveBtn: document.getElementById('saveTimes'),
    };

    const refreshSlotsPreview = () => {
      const capacity = this.parseSlotCount(this.lessonEdit.maxSlots?.value);
      if (!capacity) return;
      this.renderLessonSlots(lesson.id, bookings, capacity, this.isLessonBookable(lesson));
    };

    this.lessonEdit.saveBtn?.addEventListener('click', () => this.saveLessonTimes(lesson.id));
    const deleteBtn = document.getElementById('deleteLesson');
    if (deleteBtn) deleteBtn.onclick = () => this.deleteLesson(lesson.id);
    this.lessonEdit.maxSlots?.addEventListener('input', refreshSlotsPreview);
    this.lessonEdit.maxSlots?.addEventListener('change', refreshSlotsPreview);
  }

  async openLesson(lessonId) {
    try {
      const { lesson, bookings } = await this.api(`/api/lessons/${lessonId}/bookings`);
      this.activeLesson = lesson;
      this.lessonBookings = bookings;
      this.selectedSlot = null;
      this.adminDetailSlot = null;
      this.modalOpenedAt = Date.now();
      if (this.el.bookingHp) this.el.bookingHp.value = '';
      if (this.el.modalBookingForm) {
        this.el.modalBookingForm.hidden = true;
        this.el.modalBookingForm.innerHTML = '';
      }
      const bookable = this.isLessonBookable(lesson);
      const typeLabel = this.formatExerciseType(lesson);
      this.el.modalTitle.textContent = typeLabel || 'Lekce';
      this.el.modalSubtitle.innerHTML = this.renderLessonSubtitle(lesson);

      const capacity = this.lessonCapacity(lesson);
      const price = this.lessonPrice(lesson);
      let adminTimeHtml = '';
      if (this.adminPin) {
        adminTimeHtml = `
          <div class="modal__time-edit">
            <p class="modal__time-edit-label">Upravit lekci</p>
            <label class="modal__type-field">
              <span>Typ cvičení</span>
              <input type="text" id="editExerciseType" maxlength="60" value="${this.escapeAttr(typeLabel)}" placeholder="např. Kruháč, Yoga">
            </label>
            <div class="modal__time-fields">
              <label>Od <input type="time" id="editTimeFrom" value="${lesson.time_from || '18:30'}"></label>
              <label>Do <input type="time" id="editTimeTo" value="${lesson.time_to || '19:30'}"></label>
              <label>Míst <input type="number" id="editMaxSlots" min="1" max="100" step="1" value="${capacity}"></label>
              <label>Cena <input type="number" id="editPrice" min="0" max="100000" step="1" value="${price}"></label>
              <button type="button" class="rezervace-btn rezervace-btn--small" id="saveTimes">Uložit</button>
            </div>
          </div>`;
      }

      this.el.modalTimeEdit.innerHTML = adminTimeHtml;
      this.el.modalAdmin.classList.toggle('modal__admin-actions--visible', Boolean(this.adminPin));
      this.renderLessonSlots(lesson.id, bookings, capacity, bookable);
      this.renderCancelForm(lesson.id, bookable);

      if (this.adminPin && adminTimeHtml) {
        this.setupLessonEditForm(lesson, bookings);
      }

      this.el.modal.classList.add('modal-overlay--open');
    } catch (err) {
      alert(err.message);
    }
  }

  async saveLessonTimes(lessonId) {
    const timeFrom = this.lessonEdit?.timeFrom?.value;
    const timeTo = this.lessonEdit?.timeTo?.value;
    const title = this.lessonEdit?.title?.value?.trim() || '';
    const maxSlots = this.parseSlotCount(this.lessonEdit?.maxSlots?.value);
    const price = this.parsePrice(this.lessonEdit?.price?.value);

    if (title.length < 2) {
      alert('Vyplňte typ cvičení (min. 2 znaky)');
      return;
    }

    if (maxSlots === null) {
      alert('Počet míst musí být celé číslo mezi 1 a 100');
      return;
    }

    if (price === null) {
      alert('Cena musí být celé číslo mezi 0 a 100 000');
      return;
    }

    try {
      const updated = await this.api(`/api/lessons/${lessonId}/update`, {
        method: 'POST',
        body: JSON.stringify({ title, time_from: timeFrom, time_to: timeTo, max_slots: maxSlots, price }),
      });

      const savedCapacity = this.lessonCapacity(updated);
      if (savedCapacity !== maxSlots || this.lessonPrice(updated) !== price) {
        alert('Změny se neuložily. Restartujte server: zastavte starý proces a znovu spusťte python3 server.py');
        return;
      }

      this.showToast('Lekce uložena');
      this.activeLesson = updated;
      this.el.modalTitle.textContent = updated.title;
      this.el.modalSubtitle.innerHTML = this.renderLessonSubtitle(updated);
      await this.loadLessons();
      this.renderCalendar();
      await this.openLesson(lessonId);
    } catch (err) {
      alert(err.message);
    }
  }

  closeModal() {
    this.el.modal.classList.remove('modal-overlay--open');
    this.el.modalTimeEdit.innerHTML = '';
    if (this.el.modalCancel) this.el.modalCancel.innerHTML = '';
    if (this.el.modalBookingForm) {
      this.el.modalBookingForm.hidden = true;
      this.el.modalBookingForm.innerHTML = '';
    }
    this.lessonEdit = null;
    this.activeLesson = null;
    this.lessonBookings = [];
    this.selectedSlot = null;
    this.adminDetailSlot = null;
    this.modalOpenedAt = null;
    if (this.el.bookingHp) this.el.bookingHp.value = '';
    if (this.el.slotsGrid) this.el.slotsGrid.hidden = false;
  }

  async bookSlot(lessonId, slot) {
    const form = this.el.modalBookingForm;
    const name = form?.querySelector('.booking-form__input--name')?.value || '';
    const email = form?.querySelector('.booking-form__input--email')?.value || '';
    const phone = form?.querySelector('.booking-form__input--phone')?.value || '';
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      alert('Zadejte jméno (min. 2 znaky)');
      return;
    }
    if (!email.trim()) {
      alert('Zadejte e-mail');
      return;
    }
    if (!phone.trim()) {
      alert('Zadejte telefon');
      return;
    }
    if (!this.hasGdprConsent()) {
      alert('Pro rezervaci je nutný souhlas se zpracováním osobních údajů');
      document.getElementById('gdprConsent')?.focus();
      return;
    }

    try {
      await this.api(`/api/lessons/${lessonId}/bookings`, {
        method: 'POST',
        body: JSON.stringify({
          slot: Number(slot),
          ...this.bookingPayload(trimmed, email, phone),
        }),
      });
      this.showToast('Rezervace uložena');
      await this.openLesson(lessonId);
      await this.loadLessons();
      this.renderCalendar();
    } catch (err) {
      alert(err.message);
    }
  }

  async cancelBooking(lessonId) {
    const slot = document.getElementById('cancelSlot')?.value;
    const email = document.getElementById('cancelEmail')?.value || '';
    const phone = document.getElementById('cancelPhone')?.value || '';

    if (!slot || !email.trim() || !phone.trim()) {
      alert('Vyplňte číslo místa, e-mail a telefon');
      return;
    }

    if (!confirm(`Opravdu zrušit rezervaci na místě ${slot}?`)) return;

    try {
      await this.api(`/api/lessons/${lessonId}/bookings/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          slot: Number(slot),
          email: email.trim(),
          phone: phone.trim(),
          website: this.el.bookingHp?.value || '',
          opened_at: this.modalOpenedAt || Date.now(),
        }),
      });
      this.showToast('Rezervace zrušena');
      await this.openLesson(lessonId);
      await this.loadLessons();
      this.renderCalendar();
    } catch (err) {
      alert(err.message);
    }
  }

  async deleteBooking(lessonId, slot, name) {
    const label = name ? `"${name}"` : 'tuto rezervaci';
    if (!confirm(`Opravdu smazat klienta ${label} z místa ${slot}?`)) return;
    try {
      await this.api(`/api/lessons/${lessonId}/bookings/${slot}`, { method: 'DELETE' });
      this.showToast('Klient smazán');
      await this.openLesson(lessonId);
      await this.loadLessons();
      this.renderCalendar();
    } catch (err) {
      alert(err.message);
    }
  }

  async deleteLesson(lessonId) {
    if (!confirm('Smazat celou lekci včetně všech rezervací?')) return;
    try {
      await this.api(`/api/lessons/${lessonId}`, { method: 'DELETE' });
      this.closeModal();
      this.showToast('Lekce smazána');
      this.render();
    } catch (err) {
      alert(err.message);
    }
  }

  showToast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('toast--show');
    setTimeout(() => this.el.toast.classList.remove('toast--show'), 2500);
  }

  escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  escapeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/'/g, '&#39;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const cfg = window.REZERVACE_CONFIG;
  if (cfg) new RezervacniKalendar(cfg);
});
