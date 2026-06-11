# yaka-bridge-landing

Landing page statique de Yaka-Bridge, empaquetée pour un déploiement Coolify.

## Déploiement Coolify

- Type d'application : Dockerfile.
- Build context : racine du dépôt.
- Port exposé : `80`.
- Domaine principal : `yaka-bridge.com`.
- Domaine optionnel : `www.yaka-bridge.com`, avec redirection vers le domaine principal si Coolify le permet.
- Healthcheck : `/health`.

Le site ne nécessite aucune variable d'environnement.

## Vérification locale

```bash
docker build -t yaka-bridge-landing .
docker run --rm -p 8080:80 yaka-bridge-landing
curl -fsS http://127.0.0.1:8080/health
```

