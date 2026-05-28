from django.http import JsonResponse

from .models import AnalystUser, Organization


class TenantMiddleware:
    """Resolve the active tenant from the `X-Tenant` header.

    We picked a header-based selector instead of subdomains so the prototype
    works on any host (Render gives one URL). The frontend sets the header
    after the user picks an org from a dropdown. Unknown tenant → 400; the
    health check, admin, and SPA shell are exempt so the page can boot.
    """

    EXEMPT_PREFIXES = ("/admin", "/static", "/healthz")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith(self.EXEMPT_PREFIXES) or request.path == "/":
            return self.get_response(request)
        if not request.path.startswith("/api/"):
            return self.get_response(request)

        # Tenant-list endpoint is the bootstrap call from the UI — exempt it
        # so the dropdown can populate before a tenant is selected.
        if request.path.rstrip("/") == "/api/organizations":
            return self.get_response(request)

        tenant_slug = request.headers.get("X-Tenant")
        if not tenant_slug:
            return JsonResponse(
                {"detail": "Missing X-Tenant header."}, status=400
            )
        try:
            request.tenant = Organization.objects.get(slug=tenant_slug)
        except Organization.DoesNotExist:
            return JsonResponse(
                {"detail": f"Unknown tenant '{tenant_slug}'."}, status=400
            )

        # Analyst attribution is optional; if absent we record actions as
        # "system". This keeps demo flows trivial while still recording audit.
        analyst_email = request.headers.get("X-Analyst")
        request.analyst = None
        if analyst_email:
            request.analyst, _ = AnalystUser.objects.get_or_create(
                organization=request.tenant,
                email=analyst_email,
                defaults={"display_name": analyst_email.split("@")[0]},
            )
        return self.get_response(request)
