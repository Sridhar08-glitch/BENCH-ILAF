"""Middleware that opens CORS for the endpoints anyone may call from any website."""
from django.http import HttpResponse

# Paths that need no login: the public card pages, the plan list, invite lookup, slug check.
OPEN_PREFIXES = (
    "/api/v1/public/",
    "/api/v1/plans",
    "/api/v1/invites/",
    "/api/v1/slugs/check",
    # Uploaded pictures are public; the open header lets the browser draw a company logo onto a canvas
    # (the call-background maker) and still save the result.
    "/media/",
)


class PublicCorsMiddleware:
    """Answers preflight requests and adds a wildcard origin on the open endpoints.

    The wildcard is safe because these endpoints use no cookies and no credentials.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def _is_open(self, path):
        return path.startswith(OPEN_PREFIXES)

    def _headers(self, response):
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response["Access-Control-Allow-Headers"] = "content-type, authorization, accept-language, x-language"
        response["Access-Control-Max-Age"] = "86400"
        return response

    def __call__(self, request):
        if self._is_open(request.path):
            if request.method == "OPTIONS":
                return self._headers(HttpResponse(status=204))
            return self._headers(self.get_response(request))
        return self.get_response(request)
