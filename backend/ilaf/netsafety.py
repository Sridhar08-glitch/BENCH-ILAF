"""One definition of "an ordinary public address", shared by the link fetcher and the webhook sender."""
import ipaddress

# Ranges Python reports as global although they carry or translate to other addresses (NAT64, 6to4, IPv4-compatible
# IPv6) or belong to carrier-grade NAT.
_EXTRA_BLOCKED = [
    ipaddress.ip_network(n) for n in ("64:ff9b::/96", "64:ff9b:1::/48", "2002::/16", "::/96", "100.64.0.0/10")
]


def is_public_ip(ip):
    """True only for an ordinary public address. IPv4 hidden inside IPv6 (mapped) is unwrapped and judged as IPv4;
    the translation ranges above are refused outright."""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        elif any(ip in net for net in _EXTRA_BLOCKED):
            return False
    if not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return False
    return not any(ip.version == net.version and ip in net for net in _EXTRA_BLOCKED)
