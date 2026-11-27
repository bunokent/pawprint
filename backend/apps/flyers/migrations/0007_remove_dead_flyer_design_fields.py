# Removes dead flyer design export fields added in 0005/0006.
# Designs are now generated on-demand at download time, so these stored
# paths are no longer needed.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("flyers", "0006_flyer_design_flyer_export_pdf_path_3_and_more"),
    ]

    operations = [
        migrations.RemoveField(model_name="flyer", name="design"),
        migrations.RemoveField(model_name="flyer", name="export_pdf_path_2"),
        migrations.RemoveField(model_name="flyer", name="export_pdf_path_3"),
        migrations.RemoveField(model_name="flyer", name="export_pdf_path_4"),
        migrations.RemoveField(model_name="flyer", name="export_png_path_2"),
        migrations.RemoveField(model_name="flyer", name="export_png_path_3"),
        migrations.RemoveField(model_name="flyer", name="export_png_path_4"),
    ]
