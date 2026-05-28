from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path
from django.views.generic import TemplateView


def healthz(_request):
    return HttpResponse("ok", content_type="text/plain")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    path("healthz", healthz),
    # SPA fallback: serve the React shell so client-side routes work on refresh.
    path("", TemplateView.as_view(template_name="index.html")),
]
