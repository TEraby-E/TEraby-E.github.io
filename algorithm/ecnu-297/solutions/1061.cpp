#include <iostream>
using namespace std;

int order[10];
bool used[11];

void listOrders(int position, int n) {
    if (position == n) {
        for (int i = 0; i < n; ++i) cout << order[i];
        cout << '\n';
        return;
    }
    for (int book = 1; book <= n; ++book) {
        if (used[book] || book == position + 1) continue;
        order[position] = book;
        used[book] = true;
        listOrders(position + 1, n);
        used[book] = false;
    }
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    long long count[11] = {1, 0};
    for (int n = 2; n <= 10; ++n)
        count[n] = (n - 1) * (count[n - 1] + count[n - 2]);

    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int n;
        cin >> n;
        if (n < 8) listOrders(0, n);
        else cout << count[n] << '\n';
    }
    return 0;
}
