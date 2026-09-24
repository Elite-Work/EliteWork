/**
 * French message catalog (Francophone West Africa pilot — issue #49).
 * Keep this structurally identical to `en.ts`; only values are translated.
 */
const messages = {
  common: {
    loading: "Chargement…",
    retry: "Réessayer",
    cancel: "Annuler",
    confirm: "Confirmer",
    save: "Enregistrer",
    continue: "Continuer",
    back: "Retour",
    close: "Fermer",
    somethingWentWrong: "Une erreur est survenue",
  },
  wallet: {
    connect: "Connecter le portefeuille",
    connecting: "Connexion…",
    disconnect: "Déconnecter",
    absentTitle: "Freighter non détecté",
    absentBody:
      "Installez l'extension de navigateur Freighter pour connecter votre portefeuille.",
    absentCta: "Installer Freighter",
    lockedTitle: "Freighter est verrouillé",
    lockedBody: "Ouvrez l'extension Freighter et saisissez votre mot de passe pour continuer.",
    lockedCta: "Déverrouiller Freighter",
    rejectedTitle: "Demande de connexion refusée",
    rejectedBody: "Vous avez fermé la fenêtre Freighter. Réessayez quand vous êtes prêt.",
    rejectedCta: "Réessayer",
    wrongNetworkTitle: "Mauvais réseau sélectionné",
    wrongNetworkBody: "Basculez Freighter sur {expected} pour utiliser EziAgric.",
    wrongNetworkCta: "Basculer vers {expected}",
    timeoutTitle: "Freighter n'a pas répondu",
    timeoutBody: "L'extension a mis trop de temps à répondre. Rechargez et réessayez.",
    timeoutCta: "Réessayer",
  },
  trade: {
    createTitle: "Créer un échange",
    commodity: "Produit",
    quantity: "Quantité",
    unit: "Unité",
    pricePerUnit: "Prix unitaire ({currency})",
    currency: "Devise",
    estimatedTotal: "Total estimé",
    sellerAddress: "Adresse Stellar du vendeur",
    continueToNegotiation: "Passer à la négociation",
  },
} as const;

export default messages;
