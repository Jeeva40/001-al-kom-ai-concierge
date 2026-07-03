/* ==========================================================================
   AL-KOM — FRONTEND INTERACTIONS (VERSION 1)
   --------------------------------------------------------------------------
   Vanilla ES6+, no external libraries, no network calls. The AI concierge
   in this version is a simulated knowledge base — Version 2 will swap
   `getKnowledgeBaseResponse()` / `handleReservationStep()` for real calls
   to the Claude API.
   ========================================================================== */

(() => {
	'use strict';

	/* ==========================================================================
	   1. CONSTANTS
	   ========================================================================== */

	const STORAGE_KEYS = {
		chatHistory: 'alkom.chatHistory',
		reservations: 'alkom.reservations',
		introSeen: 'alkom.chatIntroSeen',
	};

	const RESERVATION_KEYWORDS = ['reserve', 'reservation', 'book a table', 'book', 'table'];

	const KNOWLEDGE_BASE = [
		{
			keywords: ['hello', 'hi', 'hey', 'marhaba', 'good morning', 'good afternoon', 'good evening'],
			response: "Marhaba! Welcome to Al-Kom. I can help with our menu, opening hours, location, or booking a table — what would you like to know?",
		},
		{
			keywords: ['menu', 'dish', 'food', 'eat', 'specialty', 'recommend'],
			response: "Our signature dishes include the Al-Kom Mixed Grill, slow-braised Mansaf, and Grilled Sea Bass. We also offer vegan and gluten-free options like Muhammara and our Mahshi Assortment. Would you like dietary recommendations?",
		},
		{
			keywords: ['vegan'],
			response: "For vegan guests, we recommend the Muhammara dip and our Mahshi Assortment — both are completely plant-based and full of flavor.",
		},
		{
			keywords: ['vegetarian'],
			response: "Vegetarian favorites include the Muhammara dip and our Knafeh Nabulsieh for dessert.",
		},
		{
			keywords: ['gluten'],
			response: "Gluten-free options include our Grilled Sea Bass, Mansaf, and Mahshi Assortment.",
		},
		{
			keywords: ['hour', 'open', 'close', 'time'],
			response: "We're open Monday–Thursday 5:00 PM–11:00 PM, Friday–Saturday 1:00 PM–12:00 AM, and Sunday 1:00 PM–10:00 PM.",
		},
		{
			keywords: ['where', 'location', 'address', 'direction', 'parking'],
			response: "You'll find Al-Kom at 218 Cedar Grove Avenue, Downtown District, Amman 11183. Valet parking is available at the entrance.",
		},
		{
			keywords: ['phone', 'call', 'email', 'contact'],
			response: "You can reach our team at +962 6 555 1047 or reservations@alkom-restaurant.com.",
		},
		{
			keywords: ['thank'],
			response: "You're most welcome! Is there anything else I can help you with today?",
		},
	];

	const FALLBACK_RESPONSE =
		"I'm still learning. Once connected to my AI service, I'll be able to answer that. In the meantime, I can help with our menu, hours, location, or reservations.";

	/* ==========================================================================
	   2. MODULE STATE
	   --------------------------------------------------------------------------
	   Kept inside the closure rather than on `window` — nothing here needs to
	   be global.
	   ========================================================================== */

	let chatWidgetEl = null;
	let chatMessagesEl = null;
	let chatInputEl = null;
	let chatLauncherEl = null;
	let backToTopEl = null;

	let chatHistory = [];

	const reservationState = {
		active: false,
		step: null,
		data: {},
	};

	/* ==========================================================================
	   3. GENERIC UTILITIES
	   ========================================================================== */

	/**
	 * Delays invoking `fn` until `wait` ms have passed since the last call.
	 * Used for expensive listeners (e.g. window resize) that would otherwise
	 * fire many times per second.
	 */
	function debounce(fn, wait) {
		let timeoutId;
		return function debounced(...args) {
			window.clearTimeout(timeoutId);
			timeoutId = window.setTimeout(() => fn.apply(this, args), wait);
		};
	}

	/** Escapes a value for safe insertion into innerHTML. */
	function escapeHTML(value) {
		const div = document.createElement('div');
		div.textContent = value == null ? '' : String(value);
		return div.innerHTML;
	}

	/** Formats a timestamp (ms) as a short local time string, e.g. "3:45 PM". */
	function formatTimestamp(timestamp) {
		try {
			return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} catch (error) {
			return '';
		}
	}

	/** Case-insensitive check for whether `text` contains any of `keywords`. */
	function matchesKeywords(text, keywords) {
		const normalized = text.toLowerCase();
		return keywords.some((keyword) => normalized.includes(keyword));
	}

	/** Safe localStorage read; returns `fallback` if storage is unavailable. */
	function readStorage(key, fallback) {
		try {
			const raw = window.localStorage.getItem(key);
			return raw === null ? fallback : JSON.parse(raw);
		} catch (error) {
			return fallback;
		}
	}

	/** Safe localStorage write; fails silently (e.g. private browsing mode). */
	function writeStorage(key, value) {
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
		} catch (error) {
			/* Storage unavailable — the app still works, it just won't persist. */
		}
	}

	/* ==========================================================================
	   4. STICKY NAVIGATION
	   ========================================================================== */

	function initNavigation() {
		initSmoothScrollLinks();
		initActiveNavHighlighting();
		initHeaderScrollState();
		initMobileNavToggle();
	}

	/** Returns the current rendered height of the sticky header. */
	function getHeaderOffset() {
		const header = document.querySelector('.site-header');
		return header ? header.offsetHeight : 0;
	}

	/** Scrolls smoothly to `target`, compensating for the sticky header. */
	function scrollToTarget(target) {
		if (!target) return;
		const offset = getHeaderOffset() + 16;
		const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
		window.scrollTo({ top, behavior: 'smooth' });
	}

	/** Intercepts in-page anchor links to apply header-aware smooth scrolling. */
	function initSmoothScrollLinks() {
		const links = document.querySelectorAll('a[href^="#"]');

		links.forEach((link) => {
			// Chat-widget triggers are handled separately by initChatWidget().
			if (link.getAttribute('aria-controls') === 'ai-chat-widget') return;

			link.addEventListener('click', (event) => {
				const hash = link.getAttribute('href');
				if (!hash || hash.length < 2) return;

				const target = document.querySelector(hash);
				if (!target) return;

				event.preventDefault();
				scrollToTarget(target);

				// Move focus for keyboard/screen-reader users, without re-scrolling.
				target.setAttribute('tabindex', '-1');
				target.focus({ preventScroll: true });
			});
		});
	}

	/** Highlights the nav link matching the section currently in view. */
	function initActiveNavHighlighting() {
		if (!('IntersectionObserver' in window)) return;

		const sections = document.querySelectorAll('main > section[id]');
		const navLinks = document.querySelectorAll('.main-nav a[href^="#"]');
		if (!sections.length || !navLinks.length) return;

		const linkById = new Map();
		navLinks.forEach((link) => {
			linkById.set(link.getAttribute('href').slice(1), link);
		});

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					navLinks.forEach((link) => link.classList.remove('is-active'));
					const activeLink = linkById.get(entry.target.id);
					if (activeLink) activeLink.classList.add('is-active');
				});
			},
			{ rootMargin: '-40% 0px -55% 0px', threshold: 0 }
		);

		sections.forEach((section) => observer.observe(section));
	}

	/** Adds a shadow/background change to the header once the hero has scrolled by. */
	function initHeaderScrollState() {
		const header = document.querySelector('.site-header');
		const hero = document.getElementById('home');
		if (!header || !hero || !('IntersectionObserver' in window)) return;

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					const scrolledPastHero = !entry.isIntersecting;
					header.classList.toggle('is-scrolled', scrolledPastHero);
					toggleBackToTopVisibility(scrolledPastHero);
				});
			},
			{ threshold: 0, rootMargin: '-72px 0px 0px 0px' }
		);

		observer.observe(hero);
	}

	/** Wires up a mobile nav toggle button, but only if the markup provides one. */
	function initMobileNavToggle() {
		const toggle = document.querySelector('.nav-toggle');
		const nav = document.querySelector('.main-nav');
		if (!toggle || !nav) return;

		toggle.addEventListener('click', () => {
			const isOpen = nav.classList.toggle('is-open');
			toggle.setAttribute('aria-expanded', String(isOpen));
		});
	}

	/* ==========================================================================
	   5. SCROLL REVEAL (HERO + SECTIONS + CARD GRIDS)
	   ========================================================================== */

	/** Adds `.js-reveal` and fades an element in once, via IntersectionObserver. */
	function revealOnce(element, { threshold = 0.15 } = {}) {
		if (!element) return;
		element.classList.add('js-reveal');

		if (!('IntersectionObserver' in window)) {
			element.classList.add('is-visible');
			return;
		}

		const observer = new IntersectionObserver(
			(entries, obs) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					entry.target.classList.add('is-visible');
					obs.unobserve(entry.target);
				});
			},
			{ threshold }
		);

		observer.observe(element);
	}

	/** Staggers the reveal of every `itemSelector` inside `containerSelector`. */
	function initStaggeredCardReveal(containerSelector, itemSelector, staggerMs = 90) {
		const container = document.querySelector(containerSelector);
		if (!container) return;

		const items = Array.from(container.querySelectorAll(itemSelector));
		if (!items.length) return;

		items.forEach((item) => item.classList.add('js-reveal'));

		if (!('IntersectionObserver' in window)) {
			items.forEach((item) => item.classList.add('is-visible'));
			return;
		}

		const observer = new IntersectionObserver(
			(entries, obs) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					items.forEach((item, index) => {
						window.setTimeout(() => item.classList.add('is-visible'), index * staggerMs);
					});
					obs.unobserve(entry.target);
				});
			},
			{ threshold: 0.1 }
		);

		observer.observe(container);
	}

	/** Elegant, staggered entrance animation for the hero's own content. */
	function initHero() {
		const hero = document.getElementById('home');
		if (!hero) return;

		const targets = [
			hero.querySelector('.hero-content h1'),
			hero.querySelector('.tagline'),
			hero.querySelector('.hero-description'),
			hero.querySelector('.hero-actions'),
			hero.querySelector('.hero-image'),
		].filter(Boolean);

		targets.forEach((element, index) => {
			element.classList.add('js-reveal');
			element.style.transitionDelay = `${index * 120}ms`;
		});

		// Double rAF ensures the browser has painted the initial (hidden) state
		// before the "visible" class is applied, so the transition actually runs.
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				targets.forEach((element) => element.classList.add('is-visible'));
			});
		});
	}

	/** Fades the major content sections into view as the user scrolls. */
	function initScrollAnimations() {
		['#about', '#menu', '#ai-concierge', '#how-it-works', '#reviews', '#contact'].forEach((selector) => {
			revealOnce(document.querySelector(selector));
		});

		initStaggeredCardReveal('.menu-grid', '.menu-card');
		initStaggeredCardReveal('.ai-feature-grid', '.ai-feature-card');
		initStaggeredCardReveal('.testimonial-grid', '.testimonial-card');
	}

	/* ==========================================================================
	   6. MENU CARDS
	   ========================================================================== */

	function initMenuCards() {
		const cards = document.querySelectorAll('.menu-card article');

		cards.forEach((card) => {
			card.addEventListener('pointerenter', () => card.classList.add('is-glowing'));
			card.addEventListener('pointerleave', () => card.classList.remove('is-glowing'));

			// Only wired up if a favorite button actually exists in the markup.
			const favoriteButton = card.querySelector('.favorite-button');
			if (!favoriteButton) return;

			favoriteButton.addEventListener('click', () => {
				const isFavorited = favoriteButton.classList.toggle('is-favorited');
				favoriteButton.setAttribute('aria-label', isFavorited ? 'Remove from favorites' : 'Add to favorites');
			});
		});
	}

	/* ==========================================================================
	   7. AI CONCIERGE SECTION
	   ========================================================================== */

	function initAIFeatureCards() {
		const cards = document.querySelectorAll('.ai-feature-card');
		cards.forEach((card) => {
			card.addEventListener('pointerenter', () => card.classList.add('is-glowing'));
			card.addEventListener('pointerleave', () => card.classList.remove('is-glowing'));
		});

		// Only present if a future design adds an illustration to this section.
		const illustration = document.querySelector('.ai-concierge .ai-illustration');
		if (illustration) illustration.classList.add('is-floating');
	}

	/* ==========================================================================
	   8. CHAT WIDGET — OPEN / CLOSE / MINIMIZE
	   ========================================================================== */

	function initChatWidget() {
		chatWidgetEl = document.getElementById('ai-chat-widget');
		if (!chatWidgetEl) return;

		chatMessagesEl = chatWidgetEl.querySelector('.ai-chat-messages');
		chatInputEl = document.getElementById('ai-chat-input');

		const chatForm = chatWidgetEl.querySelector('.ai-chat-form');
		const minimizeButton = chatWidgetEl.querySelector('.ai-chat-minimize');
		const closeButton = chatWidgetEl.querySelector('.ai-chat-close');
		const clearButton = chatWidgetEl.querySelector('.ai-chat-clear');

		// Bind existing page triggers (hero + AI concierge CTA) before the
		// dynamically-created launcher exists, so it isn't double-bound below.
		bindChatOpenTriggers();
		createChatLauncher();

		if (minimizeButton) minimizeButton.addEventListener('click', toggleMinimizeChatWidget);
		if (closeButton) closeButton.addEventListener('click', closeChatWidget);
		if (clearButton) clearButton.addEventListener('click', clearChatHistory);
		if (chatForm) chatForm.addEventListener('submit', handleChatFormSubmit);

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && chatWidgetEl.classList.contains('is-open')) {
				closeChatWidget();
			}
		});

		loadChat();
		initSuggestedQuestions();
		annotateInitialWelcomeMessage();
	}

	/** Wires up every element that should open the chat widget when clicked. */
	function bindChatOpenTriggers() {
		document.querySelectorAll('[aria-controls="ai-chat-widget"]').forEach((trigger) => {
			trigger.addEventListener('click', (event) => {
				event.preventDefault();
				openChatWidget();
			});
		});
	}

	/** Creates the floating launcher bubble used to reopen a closed widget. */
	function createChatLauncher() {
		const launcher = document.createElement('button');
		launcher.type = 'button';
		launcher.className = 'chat-launcher';
		launcher.setAttribute('aria-label', 'Open Al-Kom AI chat');
		launcher.setAttribute('aria-haspopup', 'dialog');
		launcher.setAttribute('aria-controls', 'ai-chat-widget');
		launcher.innerHTML = '<span aria-hidden="true">&#128172;</span>';

		if (!readStorage(STORAGE_KEYS.introSeen, false)) {
			const badge = document.createElement('span');
			badge.className = 'chat-launcher-badge';
			badge.textContent = '1';
			launcher.appendChild(badge);
		}

		launcher.addEventListener('click', openChatWidget);
		document.body.appendChild(launcher);
		chatLauncherEl = launcher;
	}

	function openChatWidget() {
		if (!chatWidgetEl) return;

		chatWidgetEl.classList.remove('is-minimized');
		chatWidgetEl.classList.add('is-open');
		chatWidgetEl.setAttribute('aria-hidden', 'false');
		if (chatLauncherEl) chatLauncherEl.classList.add('is-hidden');

		markChatIntroSeen();
		scrollMessagesToBottom();

		// Focus after the open transition has had a moment to start.
		requestAnimationFrame(() => {
			if (chatInputEl) chatInputEl.focus();
		});
	}

	function closeChatWidget() {
		if (!chatWidgetEl) return;

		chatWidgetEl.classList.remove('is-open', 'is-minimized');
		chatWidgetEl.setAttribute('aria-hidden', 'true');
		if (chatLauncherEl) chatLauncherEl.classList.remove('is-hidden');
	}

	/** Toggles between the minimized (header-only) and full widget states. */
	function toggleMinimizeChatWidget() {
		if (!chatWidgetEl) return;

		const isMinimized = chatWidgetEl.classList.toggle('is-minimized');
		const minimizeButton = chatWidgetEl.querySelector('.ai-chat-minimize');
		if (minimizeButton) {
			minimizeButton.setAttribute('aria-label', isMinimized ? 'Restore chat window' : 'Minimize chat window');
		}

		if (!isMinimized) {
			scrollMessagesToBottom();
			if (chatInputEl) chatInputEl.focus();
		}
	}

	function markChatIntroSeen() {
		const badge = chatLauncherEl ? chatLauncherEl.querySelector('.chat-launcher-badge') : null;
		if (badge) badge.remove();
		writeStorage(STORAGE_KEYS.introSeen, true);
	}

	function toggleBackToTopVisibility(visible) {
		if (backToTopEl) backToTopEl.classList.toggle('is-visible', visible);
	}

	/* ==========================================================================
	   9. CHAT MESSAGES
	   ========================================================================== */

	function scrollMessagesToBottom() {
		if (!chatMessagesEl) return;
		chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
	}

	/** Appends a single message bubble to the transcript. */
	function appendChatMessage(message, persist) {
		if (!chatMessagesEl) return;

		const wrapper = document.createElement('div');
		wrapper.className = `chat-message ${message.sender === 'user' ? 'chat-message-user' : 'chat-message-ai'}`;

		const senderLabel = message.sender === 'user' ? '' : '<span class="chat-sender">Al-Kom AI:</span> ';
		const body = message.isHTML ? message.text : escapeHTML(message.text);
		wrapper.innerHTML = `${senderLabel}${body}<span class="chat-timestamp">${formatTimestamp(message.timestamp)}</span>`;

		chatMessagesEl.appendChild(wrapper);
		scrollMessagesToBottom();

		if (persist) {
			chatHistory.push(message);
			saveChat();
		}
	}

	function addUserMessage(text) {
		appendChatMessage({ sender: 'user', text, timestamp: Date.now() }, true);
	}

	function addBotMessage(text) {
		appendChatMessage({ sender: 'ai', text, timestamp: Date.now() }, true);
	}

	function showTypingIndicator() {
		if (!chatMessagesEl || chatMessagesEl.querySelector('.typing-indicator')) return;

		const indicator = document.createElement('div');
		indicator.className = 'typing-indicator';
		indicator.setAttribute('aria-label', 'Al-Kom AI is typing');
		indicator.innerHTML = '<span></span><span></span><span></span>';

		chatMessagesEl.appendChild(indicator);
		scrollMessagesToBottom();
	}

	function hideTypingIndicator() {
		const indicator = chatMessagesEl && chatMessagesEl.querySelector('.typing-indicator');
		if (indicator) indicator.remove();
	}

	/** Clears the visible transcript, saved history, and any in-progress reservation. */
	function clearChatHistory() {
		chatHistory = [];
		reservationState.active = false;
		reservationState.step = null;
		reservationState.data = {};

		try {
			window.localStorage.removeItem(STORAGE_KEYS.chatHistory);
		} catch (error) {
			/* Storage unavailable — nothing to clean up. */
		}

		if (chatMessagesEl) chatMessagesEl.innerHTML = '';
		addBotMessage('Marhaba! How can I help you plan your visit today?');
	}

	/** Adds a timestamp to the single static welcome message baked into the HTML. */
	function annotateInitialWelcomeMessage() {
		if (!chatMessagesEl) return;
		const staticMessage = chatMessagesEl.querySelector('.chat-message-ai');
		if (!staticMessage || staticMessage.querySelector('.chat-timestamp')) return;

		const timestamp = document.createElement('span');
		timestamp.className = 'chat-timestamp';
		timestamp.textContent = formatTimestamp(Date.now());
		staticMessage.appendChild(timestamp);
	}

	/* ==========================================================================
	   10. SUGGESTED QUESTIONS
	   ========================================================================== */

	function initSuggestedQuestions() {
		document.querySelectorAll('.suggested-questions button').forEach((button) => {
			button.addEventListener('click', () => sendMessage(button.textContent.trim()));
		});
	}

	/** Shared entry point for both typed messages and suggested-question chips. */
	function sendMessage(text) {
		if (!text) return;

		addUserMessage(text);
		if (chatInputEl) chatInputEl.disabled = true;
		showTypingIndicator();

		const thinkingTime = 500 + Math.random() * 700;
		window.setTimeout(() => {
			hideTypingIndicator();
			processUserMessage(text);
			if (chatInputEl) {
				chatInputEl.disabled = false;
				chatInputEl.focus();
			}
		}, thinkingTime);
	}

	function handleChatFormSubmit(event) {
		event.preventDefault();
		if (!chatInputEl) return;

		const text = chatInputEl.value.trim();
		if (!text) return;

		chatInputEl.value = '';
		sendMessage(text);
	}

	/* ==========================================================================
	   11. SIMULATED AI RESPONSES
	   ========================================================================== */

	function getKnowledgeBaseResponse(text) {
		const match = KNOWLEDGE_BASE.find((entry) => matchesKeywords(text, entry.keywords));
		return match ? match.response : FALLBACK_RESPONSE;
	}

	/** Routes an incoming message to the reservation flow or the knowledge base. */
	function processUserMessage(text) {
		if (reservationState.active) {
			handleReservationStep(text);
			return;
		}

		if (matchesKeywords(text, RESERVATION_KEYWORDS)) {
			startReservationFlow();
			return;
		}

		addBotMessage(getKnowledgeBaseResponse(text));
	}

	/* ==========================================================================
	   12. RESERVATION DEMO (GUIDED CONVERSATION)
	   ========================================================================== */

	function startReservationFlow() {
		reservationState.active = true;
		reservationState.step = 'name';
		reservationState.data = {};
		addBotMessage("Wonderful! Let's get your table booked. First, may I have the name for the reservation?");
	}

	/** Advances the guided reservation conversation by one step. */
	function handleReservationStep(text) {
		const value = text.trim();

		switch (reservationState.step) {
			case 'name':
				if (value.length < 2) {
					addBotMessage('Could you share the full name for the reservation, please?');
					return;
				}
				reservationState.data.name = value;
				reservationState.step = 'guests';
				addBotMessage(`Thanks, ${value}! How many guests will be joining us?`);
				return;

			case 'guests': {
				const guests = parseInt(value, 10);
				if (!guests || guests < 1 || guests > 20) {
					addBotMessage('Please enter a party size between 1 and 20.');
					return;
				}
				reservationState.data.guests = guests;
				reservationState.step = 'date';
				addBotMessage(`Great, a table for ${guests}. What date would you like to reserve? (e.g. 2026-07-10)`);
				return;
			}

			case 'date':
				if (!value) {
					addBotMessage('Please let me know your preferred date.');
					return;
				}
				reservationState.data.date = value;
				reservationState.step = 'time';
				addBotMessage(`And what time should we expect you on ${value}?`);
				return;

			case 'time':
				if (!value) {
					addBotMessage('Please let me know your preferred time.');
					return;
				}
				reservationState.data.time = value;
				reservationState.step = 'phone';
				addBotMessage("Last step — what's the best phone number to reach you?");
				return;

			case 'phone': {
				const digitCount = value.replace(/\D/g, '').length;
				if (digitCount < 7) {
					addBotMessage("That phone number looks incomplete — could you double-check it?");
					return;
				}
				reservationState.data.phone = value;
				completeReservation();
				return;
			}

			default:
				// Defensive fallback — should be unreachable while active is true.
				reservationState.active = false;
				addBotMessage(getKnowledgeBaseResponse(text));
		}
	}

	function generateReservationId() {
		return `AK-${Date.now().toString(36).toUpperCase().slice(-6)}`;
	}

	function completeReservation() {
		const reservation = {
			id: generateReservationId(),
			createdAt: Date.now(),
			...reservationState.data,
		};

		saveReservation(reservation);
		addBotMessage("You're all set! Here is your reservation summary:");
		appendChatMessage({ sender: 'ai', text: createReservationCard(reservation), timestamp: Date.now(), isHTML: true }, true);

		reservationState.active = false;
		reservationState.step = null;
		reservationState.data = {};
	}

	/** Builds the HTML for a reservation confirmation card shown inside the chat. */
	function createReservationCard(reservation) {
		return `
			<div class="reservation-card">
				<h4>Reservation Confirmed</h4>
				<dl>
					<dt>Confirmation #</dt><dd>${escapeHTML(reservation.id)}</dd>
					<dt>Name</dt><dd>${escapeHTML(reservation.name)}</dd>
					<dt>Guests</dt><dd>${escapeHTML(String(reservation.guests))}</dd>
					<dt>Date</dt><dd>${escapeHTML(reservation.date)}</dd>
					<dt>Time</dt><dd>${escapeHTML(reservation.time)}</dd>
					<dt>Phone</dt><dd>${escapeHTML(reservation.phone)}</dd>
				</dl>
				<p>We look forward to hosting you at Al-Kom!</p>
			</div>
		`.trim();
	}

	/* ==========================================================================
	   13. LOCAL STORAGE — CHAT + RESERVATION HISTORY
	   ========================================================================== */

	function saveChat() {
		writeStorage(STORAGE_KEYS.chatHistory, chatHistory);
	}

	/** Restores a previously saved conversation, replacing the default welcome message. */
	function loadChat() {
		const stored = readStorage(STORAGE_KEYS.chatHistory, null);
		if (!Array.isArray(stored) || !stored.length || !chatMessagesEl) return;

		chatMessagesEl.innerHTML = '';
		stored.forEach((message) => appendChatMessage(message, false));
		chatHistory = stored;
	}

	function saveReservation(reservation) {
		const reservations = readStorage(STORAGE_KEYS.reservations, []);
		reservations.push(reservation);
		writeStorage(STORAGE_KEYS.reservations, reservations);
	}

	/* ==========================================================================
	   14. CONTACT FORM
	   ========================================================================== */

	const CONTACT_VALIDATORS = {
		name: (value) => {
			if (!value.trim()) return 'Please enter your name.';
			if (value.trim().length < 2) return 'Name must be at least 2 characters.';
			return '';
		},
		email: (value) => {
			if (!value.trim()) return 'Please enter your email address.';
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Please enter a valid email address.';
			return '';
		},
		message: (value) => {
			if (!value.trim()) return 'Please enter a message.';
			if (value.trim().length < 10) return 'Message should be at least 10 characters.';
			return '';
		},
	};

	function initContactForm() {
		const form = document.getElementById('contact-form');
		if (!form) return;

		Object.keys(CONTACT_VALIDATORS).forEach((field) => {
			const input = document.getElementById(`contact-${field}`);
			if (input) input.addEventListener('input', () => setFieldError(field, ''));
		});

		form.addEventListener('submit', (event) => {
			event.preventDefault();

			let firstInvalidInput = null;
			let isValid = true;

			// Validate every field (no short-circuiting) so all errors show at once.
			Object.keys(CONTACT_VALIDATORS).forEach((field) => {
				const input = document.getElementById(`contact-${field}`);
				if (!input) return;

				const error = CONTACT_VALIDATORS[field](input.value);
				setFieldError(field, error);
				if (error) {
					isValid = false;
					if (!firstInvalidInput) firstInvalidInput = input;
				}
			});

			if (!isValid) {
				if (firstInvalidInput) firstInvalidInput.focus();
				showNotification('Please correct the highlighted fields.', 'error');
				return;
			}

			showNotification("Thank you! Your message has been sent — we'll reply within 24 hours.", 'success');
			form.reset();
		});
	}

	function setFieldError(field, message) {
		const wrapper = document.querySelector(`.form-field[data-field="${field}"]`);
		const errorEl = document.getElementById(`contact-${field}-error`);
		if (!wrapper || !errorEl) return;

		wrapper.classList.toggle('has-error', Boolean(message));
		errorEl.textContent = message || '';
	}

	/* ==========================================================================
	   15. NOTIFICATIONS (TOASTS)
	   ========================================================================== */

	function showNotification(message, type = 'success') {
		let container = document.querySelector('.toast-container');
		if (!container) {
			container = document.createElement('div');
			container.className = 'toast-container';
			container.setAttribute('aria-live', 'polite');
			document.body.appendChild(container);
		}

		const toast = document.createElement('div');
		toast.className = `toast${type === 'error' ? ' toast-error' : ''}`;
		toast.textContent = message;
		container.appendChild(toast);

		window.setTimeout(() => {
			toast.classList.add('is-leaving');
			window.setTimeout(() => toast.remove(), 300);
		}, 4000);
	}

	/* ==========================================================================
	   16. BACK TO TOP
	   ========================================================================== */

	function initBackToTop() {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'back-to-top';
		button.setAttribute('aria-label', 'Back to top');
		button.innerHTML = '<span aria-hidden="true">&uarr;</span>';

		button.addEventListener('click', () => {
			window.scrollTo({ top: 0, behavior: 'smooth' });
		});

		document.body.appendChild(button);
		backToTopEl = button;
	}

	/* ==========================================================================
	   17. PERFORMANCE HELPERS
	   --------------------------------------------------------------------------
	   Keeps a `--app-vh` custom property in sync with the real viewport height,
	   which is the one legitimate case here for a debounced resize listener
	   (everything scroll-related above already uses IntersectionObserver).
	   ========================================================================== */

	function initViewportHeightFix() {
		const setViewportHeightProperty = () => {
			document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);
		};

		setViewportHeightProperty();
		window.addEventListener('resize', debounce(setViewportHeightProperty, 150));
	}

	/* ==========================================================================
	   18. INIT
	   ========================================================================== */

	function init() {
		initNavigation();
		initHero();
		initScrollAnimations();
		initMenuCards();
		initAIFeatureCards();
		initBackToTop();
		initChatWidget();
		initContactForm();
		initViewportHeightFix();
	}

	document.addEventListener('DOMContentLoaded', init);
})();
