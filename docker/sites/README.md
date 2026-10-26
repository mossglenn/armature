# Other sites on this server

Caddy (`docker/Caddyfile`) imports every `*.caddy` file in this directory, which is mounted read-only
into the Caddy container. A client deployed beside the instance, such as CoQui for a demonstration,
puts its own site here, so Armature's files never name a plugin:

```
coqui-demo.example.org {
	encode zstd gzip
	reverse_proxy coqui:3000
}
```

`coqui` is the client's service name on the `armature` network, which its own compose file joins as an
external network. The domain needs an `A` record pointing at this server before Caddy asks Let's Encrypt
for its certificate, as `ARMATURE_SITE` does. After adding or changing a file, reload Caddy from
`docker/`: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.

Git ignores the `*.caddy` files here: a site belongs to the server it is served from, like `docker/.env`.
The whole arrangement, and what a client must do to be safe on the network, is in
`docs/deployment.md`, "A client on the same server".
