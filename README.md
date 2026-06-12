# yaka-bridge-landing

Landing page de Yaka-Bridge, empaquetée pour un déploiement Coolify avec un petit serveur Node qui sert le site et le système de prise de rendez-vous.

## Déploiement Coolify

- Type d'application : Dockerfile.
- Build context : racine du dépôt.
- Port exposé : `80`.
- Domaine principal : `yaka-bridge.com`.
- Domaine optionnel : `www.yaka-bridge.com`, avec redirection vers le domaine principal si Coolify le permet.
- Healthcheck : `/health`.

## Rendez-vous

Le parcours RDV est exposé via :

- `GET /api/booking/availability?month=YYYY-MM`
- `POST /api/booking/confirm`

Variables d'environnement recommandées :

- `SITE_URL` : URL publique, par défaut `https://yaka-bridge.com`.
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` : calendrier cible, par défaut `primary`.
- `RESEND_API_KEY`
- `BOOKING_EMAIL_FROM` : expéditeur Resend, par défaut `Yaka-Bridge <noreply@yaka-bridge.com>`.
- `BOOKING_NOTIFICATION_EMAIL` : email qui reçoit les demandes, par défaut `nicolas.cleton@yaka-performance.com`.
- `BOOKING_DURATION_MINUTES` : durée d'un créneau, par défaut `30`.
- `BOOKING_PREVIEW_SLOTS` : `true` pour afficher des créneaux sans Google Calendar. Par défaut, actif hors production et inactif en production.

Sans les variables Google en production, l'API de disponibilité renvoie `503` afin de ne pas publier de créneaux fictifs.

## Vérification locale

```bash
docker build -t yaka-bridge-landing .
docker run --rm -p 8080:80 yaka-bridge-landing
curl -fsS http://127.0.0.1:8080/health
curl -fsS "http://127.0.0.1:8080/api/booking/availability?month=2026-06"
```
