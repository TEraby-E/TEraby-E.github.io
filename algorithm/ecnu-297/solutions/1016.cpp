#include <iostream>
#include <utility>
#include <vector>
using namespace std;

void print(const vector<int> &a) {
    for (int i = 0; i < static_cast<int>(a.size()); ++i) {
        if (i > 0) cout << ' ';
        cout << a[i];
    }
    cout << '\n';
}

int partition(vector<int> &a, int left, int right) {
    int pivot = a[right], split = left;
    for (int i = left; i < right; ++i) {
        if (a[i] <= pivot) swap(a[split++], a[i]);
    }
    swap(a[split], a[right]);
    return split;
}

void quickSort(vector<int> &a, int left, int right) {
    if (left >= right) return;
    int split = partition(a, left, right);
    print(a);
    quickSort(a, left, split - 1);
    quickSort(a, split + 1, right);
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<int> a(n);
    for (int &x : a) cin >> x;
    quickSort(a, 0, n - 1);
    print(a);
}
