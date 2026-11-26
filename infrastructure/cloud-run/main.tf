terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "image" {
  type        = string
  description = "Published container URI pinned by digest."
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Set image to a container URI pinned by its sha256 digest."
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_service_account" "forecast" {
  account_id   = "forecast-lab"
  display_name = "Forecast Lab Cloud Run identity"
}

resource "google_cloud_run_v2_service" "forecast" {
  name                = "forecast-value-added-lab"
  location            = var.region
  deletion_protection = true

  template {
    service_account = google_service_account.forecast.email
    scaling {
      max_instance_count = 2
    }
    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }
    }
  }
}

output "service_uri" {
  value = google_cloud_run_v2_service.forecast.uri
}
