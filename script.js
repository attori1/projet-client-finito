/* =============================================================
   STK Architecture — Biomimétisme : Le Jeu
   Logique principale du jeu d'association.
   ============================================================= */

   (() => {
    'use strict';
  
    // -----------------------------------------------------------
    // CONFIGURATION
    // -----------------------------------------------------------
    const CONFIG = {
      dataPath: 'data.json',
      storageKey: 'stk-biomim-state-v2',
      slotsPerRound: 12,            // grille 4x3
      pairsPerRound: 5,             // 5 paires = 10 cartes + 2 vides
      cardRevealStagger: 40,        // ms entre l'apparition de chaque carte
      correctAnimDuration: 650,     // ms — temps avant d'ouvrir la modale
      wrongResetDuration: 900       // ms avant de désélectionner après erreur
    };
  
    // -----------------------------------------------------------
    // ÉTAT
    // -----------------------------------------------------------
    const state = {
      data: null,                   // contenu de data.json
      currentRound: 1,              // 1..4
      foundByRound: {},             // { 1: ['r1-p1', ...], 2: [...] }
      erroredCards: {},             // { 'r1-p1__bio': 2, ... } — compteur d'erreurs par carte
      layoutByRound: {},            // { 1: [<slotConfig>...], ... }
      selected: [],                 // tableau de 0 à 2 cartes en cours de sélection
      locked: false                 // bloque les clics pendant l'animation
    };
  
    // -----------------------------------------------------------
    // DOM — sélecteurs réutilisés
    // -----------------------------------------------------------
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  
    const els = {
      viewLanding: null,
      viewGame: null,
      btnStart: null,
      btnQuit: null,
      board: null,
      phase: null,
      found: null,
      total: null,
  
      hintToast: null,
      hintToastText: null,
      hintToastClose: null,
  
      modalPair: null,
      modalPairTitle: null,
      modalPairBioName: null,
      modalPairArchiName: null,
      modalPairBioImg: null,
      modalPairArchiImg: null,
      modalPairText: null,
      modalPairContinue: null,
  
      modalRound: null,
      modalRoundTitle: null,
      modalRoundText: null,
      modalRoundFill: null,
      modalRoundPercent: null,
      modalRoundContinue: null,
  
      modalEnd: null,
      modalEndRestart: null,
      modalEndClose: null
    };
  
    // -----------------------------------------------------------
    // UTILITAIRES
    // -----------------------------------------------------------
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
  
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  
    // -----------------------------------------------------------
    // PERSISTANCE — localStorage
    // -----------------------------------------------------------
    const saveState = () => {
      try {
        const snapshot = {
          currentRound: state.currentRound,
          foundByRound: state.foundByRound,
          erroredCards: state.erroredCards,
          layoutByRound: state.layoutByRound
        };
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(snapshot));
      } catch (e) {
        console.warn('Impossible de sauvegarder la progression', e);
      }
    };
  
    const loadState = () => {
      try {
        const raw = localStorage.getItem(CONFIG.storageKey);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    };
  
    const clearState = () => {
      try {
        localStorage.removeItem(CONFIG.storageKey);
      } catch (e) { /* noop */ }
    };
  
    // -----------------------------------------------------------
    // GÉNÉRATION DU LAYOUT D'UNE MANCHE
    // -----------------------------------------------------------
    /**
     * Construit la liste de 12 slots pour la manche donnée.
     * Chaque slot : { type: 'card', pairId, side, ... } ou { type: 'empty' }.
     */
    const buildRoundLayout = (round) => {
      const roundData = state.data.rounds.find((r) => r.round === round);
      if (!roundData) return [];
  
      const cards = [];
      roundData.pairs.forEach((pair) => {
        cards.push({
          type: 'card',
          pairId: pair.id,
          side: 'bio',
          name: pair.bio.name,
          label: pair.bio.label,
          image: pair.bio.image,
          caption: pair.bio.caption
        });
        cards.push({
          type: 'card',
          pairId: pair.id,
          side: 'archi',
          name: pair.archi.name,
          label: pair.archi.label,
          image: pair.archi.image,
          caption: pair.archi.caption
        });
      });
  
      // Compléter à 12 slots avec des cases vides
      while (cards.length < CONFIG.slotsPerRound) {
        cards.push({ type: 'empty' });
      }
  
      return shuffle(cards);
    };
  
    const getOrBuildLayout = (round) => {
      if (state.layoutByRound[round]) {
        return state.layoutByRound[round];
      }
      const layout = buildRoundLayout(round);
      state.layoutByRound[round] = layout;
      saveState();
      return layout;
    };
  
    // -----------------------------------------------------------
    // RECHERCHE D'UNE PAIRE PAR ID
    // -----------------------------------------------------------
    const findPair = (round, pairId) => {
      const r = state.data.rounds.find((x) => x.round === round);
      return r ? r.pairs.find((p) => p.id === pairId) : null;
    };
  
    // -----------------------------------------------------------
    // RENDU DU PLATEAU
    // -----------------------------------------------------------
    const renderBoard = () => {
      const round = state.currentRound;
      const layout = getOrBuildLayout(round);
      const found = state.foundByRound[round] || [];
      const roundData = state.data.rounds.find((r) => r.round === round);
  
      // En-tête de manche
      els.phase.textContent = `Manche ${round} / ${state.data.rounds.length}`;
      els.total.textContent = CONFIG.pairsPerRound;
      els.found.textContent = found.length;
  
      // Background de manche
      if (roundData.background) {
        els.viewGame.style.setProperty('--round-bg', `url('${roundData.background}')`);
        els.viewGame.classList.add('has-round-bg');
      } else {
        els.viewGame.style.removeProperty('--round-bg');
        els.viewGame.classList.remove('has-round-bg');
      }
  
      // Vidage
      els.board.innerHTML = '';
  
      // Opacité du background selon les paires déjà trouvées (reprise de session)
      revealBackground(found.length, CONFIG.pairsPerRound);
  
      layout.forEach((slot, i) => {
        let cardEl;
        if (slot.type === 'empty') {
          cardEl = document.createElement('div');
          cardEl.className = 'card card--empty';
          cardEl.setAttribute('aria-hidden', 'true');
        } else {
          cardEl = document.createElement('button');
          cardEl.type = 'button';
          cardEl.className = 'card';
          cardEl.dataset.pairId = slot.pairId;
          cardEl.dataset.side = slot.side;
          cardEl.dataset.index = String(i);
          cardEl.setAttribute('aria-label', `${slot.label} : ${slot.name}`);
  
          // État résolu
          if (found.includes(slot.pairId)) {
            cardEl.classList.add('card--solved');
          }
  
          // Label discret
          const labelEl = document.createElement('span');
          labelEl.className = `card__label card__label--${slot.side}`;
          labelEl.textContent = slot.label;
          cardEl.appendChild(labelEl);
  
          // Média (image ou placeholder)
          const mediaEl = document.createElement('div');
          mediaEl.className = 'card__media';
          if (slot.image) {
            // L'image utilisateur sera intégrée plus tard ;
            // tant que le fichier n'existe pas, le placeholder CSS reste visible.
            mediaEl.style.backgroundImage = `url('${slot.image}')`;
          }
          cardEl.appendChild(mediaEl);
  
          // Nom
          const nameEl = document.createElement('p');
          nameEl.className = 'card__name';
          nameEl.textContent = slot.name;
          cardEl.appendChild(nameEl);
  
          // Légende
          const captionEl = document.createElement('p');
          captionEl.className = 'card__caption';
          captionEl.textContent = slot.caption;
          cardEl.appendChild(captionEl);
  
          cardEl.addEventListener('click', onCardClick);
        }
  
        cardEl.style.setProperty('--card-i', String(i));
        els.board.appendChild(cardEl);
      });
    };
  
    // -----------------------------------------------------------
    // SÉLECTION DE CARTE
    // -----------------------------------------------------------
    const onCardClick = (e) => {
      if (state.locked) return;
      const cardEl = e.currentTarget;
      if (cardEl.classList.contains('card--solved')) return;
  
      const pairId = cardEl.dataset.pairId;
      const side = cardEl.dataset.side;
  
      // Désélection si on reclique la même carte
      if (cardEl.classList.contains('card--selected')) {
        cardEl.classList.remove('card--selected');
        state.selected = state.selected.filter((s) => s.el !== cardEl);
        return;
      }
  
      // Si déjà 2 cartes sélectionnées, on ignore (sécurité, normalement locked)
      if (state.selected.length >= 2) return;
  
      // Ajoute à la sélection
      cardEl.classList.add('card--selected');
      state.selected.push({ el: cardEl, pairId, side });
  
      // Si 2 cartes sélectionnées, on valide
      if (state.selected.length === 2) {
        evaluateSelection();
      }
    };
  
    // -----------------------------------------------------------
    // DÉVOILEMENT PROGRESSIF DE L'ARBRE
    // L'arbre démarre à opacité 0 et gagne +20% par bonne paire
    // (0 → 0.2 → 0.4 → 0.6 → 0.8 → 1.0).
    // Un très léger scale est couplé pour donner l'impression
    // qu'il "pousse" / se révèle subtilement.
    // -----------------------------------------------------------
    const revealBackground = (found, total) => {
      const ratio = total > 0 ? found / total : 0;
      const opacity = ratio;                  // 0 → 1
      const scale = 1 + (ratio * 0.04);       // 1 → 1.04 (très léger)
      els.viewGame.style.setProperty('--bg-opacity', opacity.toFixed(3));
      els.viewGame.style.setProperty('--bg-scale', scale.toFixed(4));
    };
  
    // -----------------------------------------------------------
    // ÉVALUATION DE LA SÉLECTION
    // -----------------------------------------------------------
    const evaluateSelection = async () => {
      const [a, b] = state.selected;
  
      // Critère de succès : même pairId ET sides différents (un bio + un archi)
      const samePair = a.pairId === b.pairId;
      const differentSides = a.side !== b.side;
      const isMatch = samePair && differentSides;
  
      state.locked = true;
  
      if (isMatch) {
        await handleCorrect(a, b);
      } else {
        await handleWrong(a, b);
      }
  
      state.locked = false;
    };
  
    // -----------------------------------------------------------
    // CAS — BONNE PAIRE
    // -----------------------------------------------------------
    const handleCorrect = async (a, b) => {
      a.el.classList.remove('card--selected');
      b.el.classList.remove('card--selected');
      a.el.classList.add('card--correct');
      b.el.classList.add('card--correct');
  
      await sleep(CONFIG.correctAnimDuration);
  
      a.el.classList.remove('card--correct');
      b.el.classList.remove('card--correct');
      a.el.classList.add('card--solved');
      b.el.classList.add('card--solved');
  
      // Enregistre la paire trouvée
      const round = state.currentRound;
      if (!state.foundByRound[round]) state.foundByRound[round] = [];
      if (!state.foundByRound[round].includes(a.pairId)) {
        state.foundByRound[round].push(a.pairId);
      }
      els.found.textContent = state.foundByRound[round].length;
      saveState();
  
      // Dévoile progressivement le background selon les paires trouvées
      revealBackground(state.foundByRound[round].length, CONFIG.pairsPerRound);
  
      // Vide la sélection
      state.selected = [];
  
      // Ferme l'indice s'il est affiché (bonne réponse trouvée)
      hideHint();
  
      // Affiche le pop-up pédagogique
      openPairModal(a.pairId);
    };
  
    // -----------------------------------------------------------
    // CAS — MAUVAISE PAIRE
    // L'indice s'affiche dès qu'une des deux cartes a déjà fait
    // 2 erreurs ou plus (peu importe avec quelle autre carte).
    // -----------------------------------------------------------
    const handleWrong = async (a, b) => {
      a.el.classList.add('card--wrong');
      b.el.classList.add('card--wrong');
  
      // Identifiants des cartes
      const k1 = `${a.pairId}__${a.side}`;
      const k2 = `${b.pairId}__${b.side}`;
  
      // Compteurs d'erreurs par carte (nombre de fois où cette carte a été dans une mauvaise paire)
      const countA = (state.erroredCards[k1] || 0) + 1;
      const countB = (state.erroredCards[k2] || 0) + 1;
  
      state.erroredCards[k1] = countA;
      state.erroredCards[k2] = countB;
      saveState();
  
      // Affiche l'indice si l'une des deux cartes a déjà fait 2 erreurs ou plus
      // (càd c'est au moins sa 2e tentative incorrecte)
      if (countA >= 2) {
        showHint(a.pairId);
      } else if (countB >= 2) {
        showHint(b.pairId);
      }
  
      await sleep(CONFIG.wrongResetDuration);
  
      a.el.classList.remove('card--wrong', 'card--selected');
      b.el.classList.remove('card--wrong', 'card--selected');
  
      state.selected = [];
    };
  
    // -----------------------------------------------------------
    // INDICES
    // L'indice reste affiché jusqu'à ce que :
    // 1. Le joueur trouve une bonne réponse (fermeture auto)
    // 2. Le joueur clique sur la croix × (fermeture manuelle)
    // -----------------------------------------------------------
    const showHint = (pairId) => {
      const pair = findPair(state.currentRound, pairId);
      if (!pair || !pair.hint) return;
  
      els.hintToastText.textContent = pair.hint;
      els.hintToast.hidden = false;
      // Force un reflow pour que la transition CSS prenne effet
      void els.hintToast.offsetWidth;
      els.hintToast.classList.add('is-visible');
    };
  
    const hideHint = () => {
      els.hintToast.classList.remove('is-visible');
      setTimeout(() => {
        els.hintToast.hidden = true;
      }, 460);
    };
  
    // -----------------------------------------------------------
    // MODALES — Ouverture / Fermeture
    // -----------------------------------------------------------
    const openModal = (modalEl) => {
      modalEl.hidden = false;
      // Re-trigger les animations CSS
      modalEl.querySelectorAll('.modal__backdrop, .modal__panel').forEach((el) => {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      });
    };
  
    const closeModal = (modalEl) => {
      modalEl.hidden = true;
    };
  
    const openPairModal = (pairId) => {
      const pair = findPair(state.currentRound, pairId);
      if (!pair) return;
  
      els.modalPairTitle.textContent = pair.explanation.title;
      els.modalPairBioName.textContent = pair.bio.name;
      els.modalPairArchiName.textContent = pair.archi.name;
      els.modalPairText.textContent = pair.explanation.text;
  
      // Backgrounds des visuels (fonctionne avec ou sans image)
      if (pair.bio.image) {
        els.modalPairBioImg.style.backgroundImage = `url('${pair.bio.image}')`;
      } else {
        els.modalPairBioImg.style.backgroundImage = '';
      }
      if (pair.archi.image) {
        els.modalPairArchiImg.style.backgroundImage = `url('${pair.archi.image}')`;
      } else {
        els.modalPairArchiImg.style.backgroundImage = '';
      }
  
      openModal(els.modalPair);
    };
  
    const onPairModalContinue = () => {
      closeModal(els.modalPair);
  
      const round = state.currentRound;
      const found = state.foundByRound[round] || [];
  
      if (found.length >= CONFIG.pairsPerRound) {
        // Fin de manche
        if (round >= state.data.rounds.length) {
          // Fin de jeu
          openEndModal();
        } else {
          openRoundModal();
        }
      }
    };
  
    // -----------------------------------------------------------
    // MODALE — FIN DE MANCHE
    // -----------------------------------------------------------
    const openRoundModal = () => {
      const totalRounds = state.data.rounds.length;
      const completed = state.currentRound;
      const pct = Math.round((completed / totalRounds) * 100);
  
      els.modalRoundTitle.textContent = `Manche ${completed} complétée`;
      els.modalRoundText.textContent =
        'Cinq associations trouvées. Vous progressez dans la lecture des stratégies du vivant.';
      els.modalRoundPercent.textContent = `${pct}%`;
  
      openModal(els.modalRound);
  
      // Animation de remplissage de la barre, déclenchée après l'apparition
      requestAnimationFrame(() => {
        setTimeout(() => {
          els.modalRoundFill.style.width = `${pct}%`;
        }, 200);
      });
    };
  
    const onRoundModalContinue = () => {
      closeModal(els.modalRound);
      els.modalRoundFill.style.width = '0%';
  
      state.currentRound += 1;
      state.selected = [];
      saveState();
  
      renderBoard();
    };
  
    // -----------------------------------------------------------
    // MODALE — FIN DE JEU
    // -----------------------------------------------------------
    const openEndModal = () => {
      openModal(els.modalEnd);
    };
  
    const onEndRestart = () => {
      closeModal(els.modalEnd);
      resetGame();
      showView('game');
    };
  
    const onEndClose = () => {
      closeModal(els.modalEnd);
      showView('landing');
    };
  
    // -----------------------------------------------------------
    // RÉINITIALISATION
    // -----------------------------------------------------------
    const resetGame = () => {
      state.currentRound = 1;
      state.foundByRound = {};
      state.erroredCards = {};
      state.layoutByRound = {};
      state.selected = [];
      clearState();
      renderBoard();
    };
  
    // -----------------------------------------------------------
    // VUES
    // -----------------------------------------------------------
    const showView = (name) => {
      if (name === 'landing') {
        els.viewLanding.hidden = false;
        els.viewGame.hidden = true;
      } else if (name === 'game') {
        els.viewLanding.hidden = true;
        els.viewGame.hidden = false;
        renderBoard();
      }
    };
  
    // -----------------------------------------------------------
    // DÉMARRAGE / REPRISE
    // -----------------------------------------------------------
    const startGame = () => {
      const saved = loadState();
      if (saved && saved.currentRound) {
        // Reprend une session existante
        state.currentRound = saved.currentRound;
        state.foundByRound = saved.foundByRound || {};
        state.erroredCards = saved.erroredCards || {};
        state.layoutByRound = saved.layoutByRound || {};
  
        // Sécurité : si la manche en cours est déjà complétée à la reprise,
        // on passe à la suivante (ou on termine).
        const round = state.currentRound;
        const found = state.foundByRound[round] || [];
        if (found.length >= CONFIG.pairsPerRound) {
          if (round >= state.data.rounds.length) {
            showView('game');
            openEndModal();
            return;
          }
          state.currentRound += 1;
          saveState();
        }
      } else {
        // Nouvelle partie
        state.currentRound = 1;
        state.foundByRound = {};
        state.erroredCards = {};
        state.layoutByRound = {};
      }
      showView('game');
    };
  
    const onQuit = () => {
      saveState();
      showView('landing');
      updateStartButtonLabel();
    };
  
    // Met à jour le libellé du bouton landing (Commencer / Reprendre)
    const updateStartButtonLabel = () => {
      const saved = loadState();
      const hasProgress =
        saved &&
        saved.foundByRound &&
        Object.values(saved.foundByRound).some(
          (arr) => Array.isArray(arr) && arr.length > 0
        );
      els.btnStart.textContent = hasProgress
        ? 'Reprendre l\'expérience'
        : "Commencer l'expérience";
    };
  
    // -----------------------------------------------------------
    // BIND DES ÉLÉMENTS DOM
    // -----------------------------------------------------------
    const bindDom = () => {
      els.viewLanding = $('#view-landing');
      els.viewGame = $('#view-game');
      els.btnStart = $('#btn-start');
      els.btnQuit = $('#btn-quit');
      els.board = $('#board');
      els.phase = $('#game-phase');
      els.found = $('#game-found');
      els.total = $('#game-total');
  
      els.hintToast = $('#hint-toast');
      els.hintToastText = $('#hint-toast-text');
      els.hintToastClose = $('#hint-toast-close');
  
      els.modalPair = $('#modal-pair');
      els.modalPairTitle = $('#modal-pair-title');
      els.modalPairBioName = $('#modal-pair-bio-name');
      els.modalPairArchiName = $('#modal-pair-archi-name');
      els.modalPairBioImg = $('#modal-pair-bio-image');
      els.modalPairArchiImg = $('#modal-pair-archi-image');
      els.modalPairText = $('#modal-pair-text');
      els.modalPairContinue = $('#modal-pair-continue');
  
      els.modalRound = $('#modal-round');
      els.modalRoundTitle = $('#modal-round-title');
      els.modalRoundText = $('#modal-round-text');
      els.modalRoundFill = $('#modal-round-fill');
      els.modalRoundPercent = $('#modal-round-percent');
      els.modalRoundContinue = $('#modal-round-continue');
  
      els.modalEnd = $('#modal-end');
      els.modalEndRestart = $('#modal-end-restart');
      els.modalEndClose = $('#modal-end-close');
  
      els.btnStart.addEventListener('click', startGame);
      els.btnQuit.addEventListener('click', onQuit);
      els.hintToastClose.addEventListener('click', hideHint);
      els.modalPairContinue.addEventListener('click', onPairModalContinue);
      els.modalRoundContinue.addEventListener('click', onRoundModalContinue);
      els.modalEndRestart.addEventListener('click', onEndRestart);
      els.modalEndClose.addEventListener('click', onEndClose);
  
      // Échap ferme la modale paire (mais pas les autres qui sont des
      // transitions obligatoires)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !els.modalPair.hidden) {
          onPairModalContinue();
        }
      });
    };
  
    // -----------------------------------------------------------
    // INITIALISATION
    // -----------------------------------------------------------
    const init = async () => {
      bindDom();
  
      try {
        const res = await fetch(CONFIG.dataPath);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.data = await res.json();
      } catch (e) {
        console.error('Impossible de charger data.json', e);
        els.viewLanding.innerHTML =
          '<div style="padding:48px; text-align:center; color:#a85d3e;">' +
          'Erreur de chargement des données du jeu.<br>' +
          'Vérifie que <code>data.json</code> est bien servi depuis un serveur HTTP.' +
          '</div>';
        return;
      }
  
      updateStartButtonLabel();
      
      // Gestion de la vidéo d'arrière-plan
      initLandingVideo();
    };
  
    // -----------------------------------------------------------
    // VIDÉO D'ARRIÈRE-PLAN — Boucle après 15 secondes
    // -----------------------------------------------------------
    const initLandingVideo = () => {
      const video = document.getElementById('landing-video');
      if (!video) return;
      
      let hasLooped = false;
      
      video.addEventListener('timeupdate', () => {
        // Après 15 secondes, retour au début
        if (!hasLooped && video.currentTime >= 15) {
          video.currentTime = 0;
          hasLooped = true;
        }
      });
      
      // Quand la vidéo se termine naturellement, la relancer
      video.addEventListener('ended', () => {
        video.currentTime = 0;
        video.play();
      });
    };
  
    // -----------------------------------------------------------
    // GO
    // -----------------------------------------------------------
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();