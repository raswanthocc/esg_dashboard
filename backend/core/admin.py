from django.contrib import admin

from .models import AnalystUser, Organization

admin.site.register(Organization)
admin.site.register(AnalystUser)
