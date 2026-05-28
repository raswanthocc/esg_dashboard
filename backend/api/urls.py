from django.urls import path

from . import views

urlpatterns = [
    path("organizations", views.organizations),
    path("summary", views.summary),
    path("batches", views.batches_list),
    path("batches/upload", views.UploadView.as_view()),
    path("batches/<int:pk>", views.batch_detail),
    path("records", views.records_list),
    path("records/bulk-approve", views.records_bulk_approve),
    path("records/<int:pk>", views.record_detail),
    path("records/<int:pk>/approve", views.record_approve),
    path("records/<int:pk>/reject", views.record_reject),
]
