from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0013_custom_domain_data'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='workspace',
            name='custom_domain',
        ),
    ]
